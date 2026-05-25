const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const path = require('path');

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const salas = {};
const categoriasPadrao = ["Nome", "Animal", "Fruta", "Cor", "Objeto", "País", "Minha Sogra É", "Marca", "Filme", "Profissão"];

io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    socket.on('criarSala', (nome) => {
        if (!nome) return;
        const codigo = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        salas[codigo] = {
            codigo: codigo,
            donoId: socket.id,
            jogadores: [{ id: socket.id, nome: nome, pontos: 0 }],
            status: 'lobby',
            letraAtual: '',
            rodadaAtual: 0,
            letrasSorteadas: [],
            categoriasDisponiveis: [...categoriasPadrao], 
            categoriasAtivas: [...categoriasPadrao],     
            config: {
                tempo: 60,
                totalRodadas: 5,
                pontosNormal: 10,
                pontosRepetida: 5,
                limiteJogadores: 8,
                qtdVencedores: 1,
                modoJogo: 'tempo',
                votacaoAtiva: true
            },
            respostasRodada: {}, // idJogador -> { categoria: palavra }
            votosRodada: {},      // categoria -> palavra -> { idJogador: true/false }
            respostasValidadas: {} // categoria -> palavra -> boolean
        };
        socket.join(codigo);
        socket.emit('salaCriada', codigo);
        io.to(codigo).emit('atualizarSala', salas[codigo]);
    });

    socket.on('joinRoom', ({ roomCode, name }) => {
        if (!roomCode) return;
        const codigo = roomCode.toUpperCase();
        if (salas[codigo]) {
            const sala = salas[codigo];
            if (sala.jogadores.length >= sala.config.limiteJogadores) {
                return socket.emit('erro', 'A sala já está cheia!');
            }
            const jaExiste = sala.jogadores.find(p => p.id === socket.id);
            if (!jaExiste && name) {
                sala.jogadores.push({ id: socket.id, nome: name, pontos: 0 });
            }
            socket.join(codigo);
            io.to(codigo).emit('atualizarSala', sala);
        } else {
            socket.emit('erro', 'Sala não encontrada');
        }
    });

    socket.on('adicionarTema', ({ roomCode, novoTema }) => {
        const sala = salas[roomCode];
        if (sala && sala.donoId === socket.id && novoTema) {
            const temaTratado = novoTema.trim();
            if (!sala.categoriasDisponiveis.includes(temaTratado)) {
                sala.categoriasDisponiveis.push(temaTratado);
                sala.categoriasAtivas.push(temaTratado); 
                io.to(roomCode).emit('atualizarSala', sala);
            }
        }
    });

    socket.on('deletarTema', ({ roomCode, tema }) => {
        const sala = salas[roomCode];
        if (sala && sala.donoId === socket.id) {
            sala.categoriasDisponiveis = sala.categoriasDisponiveis.filter(c => c !== tema);
            sala.categoriasAtivas = sala.categoriasAtivas.filter(c => c !== tema);
            io.to(roomCode).emit('atualizarSala', sala);
        }
    });

    socket.on('atualizarCategoriasAtivas', ({ roomCode, categoriasSelecionadas }) => {
        const sala = salas[roomCode];
        if (sala && sala.donoId === socket.id && categoriasSelecionadas) {
            sala.categoriasAtivas = categoriasSelecionadas;
            io.to(roomCode).emit('atualizarSala', sala);
        }
    });

    socket.on('salvarConfiguracoes', ({ roomCode, novaConfig }) => {
        const sala = salas[roomCode];
        if (sala && sala.donoId === socket.id) {
            sala.config = { ...sala.config, ...novaConfig };
            io.to(roomCode).emit('atualizarSala', sala);
        }
    });

    socket.on('expulsarJogador', ({ roomCode, jogadorId }) => {
        const sala = salas[roomCode];
        if (sala && sala.donoId === socket.id && jogadorId !== socket.id) {
            sala.jogadores = sala.jogadores.filter(p => p.id !== jogadorId);
            io.to(jogadorId).emit('mensagemExpulso', 'você foi expulso');
            const targetSocket = io.sockets.sockets.get(jogadorId);
            if (targetSocket) targetSocket.leave(roomCode);
            io.to(roomCode).emit('atualizarSala', sala);
        }
    });

    socket.on('startRound', (codigo) => {
        const sala = salas[codigo];
        if (sala && (sala.status === 'lobby' || sala.status === 'resultados')) {
            if (sala.categoriasAtivas.length === 0) {
                return io.to(sala.donoId).emit('erro', 'Marque pelo menos uma palavra para jogar!');
            }
            
            if (sala.status === 'lobby') {
                sala.rodadaAtual = 1;
                sala.jogadores.forEach(p => p.pontos = 0);
                sala.letrasSorteadas = [];
            } else {
                sala.rodadaAtual++;
            }

            if (sala.rodadaAtual > sala.config.totalRodadas) {
                sala.status = 'lobby';
                io.to(codigo).emit('atualizarSala', sala);
                return;
            }

            sala.status = 'jogando';
            sala.respostasRodada = {};
            sala.votosRodada = {};
            sala.respostasValidadas = {};

            const letrasPossiveis = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => !sala.letrasSorteadas.includes(l));
            const letraSorteada = letrasPossiveis.length > 0 
                ? letrasPossiveis[Math.floor(Math.random() * letrasPossiveis.length)]
                : 'A';
            
            sala.letrasSorteadas.push(letraSorteada);
            sala.letraAtual = letraSorteada;

            let categoriasEmbaralhadas = [...sala.categoriasAtivas];
            for (let i = categoriasEmbaralhadas.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [categoriasEmbaralhadas[i], categoriasEmbaralhadas[j]] = [categoriasEmbaralhadas[j], categoriasEmbaralhadas[i]]; 
            }

            io.to(codigo).emit('rodadaIniciada', { 
                letra: letraSorteada, 
                config: sala.config,
                categoriasOrdem: categoriasEmbaralhadas,
                rodadaAtual: sala.rodadaAtual
            });
        }
    });

    socket.on('baterStop', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.status === 'jogando') {
            sala.status = 'recolhendo';
            const jogador = sala.jogadores.find(p => p.id === socket.id);
            io.to(codigo).emit('fimDeTempo', { apelidoStop: jogador ? jogador.nome : 'Alguém' });
        }
    });

    socket.on('enviarRespostas', ({ roomCode, respostas }) => {
        const sala = salas[roomCode];
        if (sala && (sala.status === 'jogando' || sala.status === 'recolhendo')) {
            sala.respostasRodada[socket.id] = respostas;

            // Se todos os jogadores enviaram ou tempo esgotou
            if (Object.keys(sala.respostasRodada).length >= sala.jogadores.length) {
                processarFaseVotacao(roomCode);
            }
        }
    });

    function processarFaseVotacao(roomCode) {
        const sala = salas[roomCode];
        if (!sala) return;

        if (sala.config.votacaoAtiva) {
            sala.status = 'votacao';
            io.to(roomCode).emit('entrarVotacao', {
                respostas: sala.respostasRodada,
                jogadores: sala.jogadores,
                categorias: sala.categoriasAtivas,
                letra: sala.letraAtual
            });
        } else {
            calcularPontuacaoFinais(roomCode);
        }
    }

    socket.on('enviarVotos', ({ roomCode, votos }) => {
        const sala = salas[roomCode];
        if (sala && sala.status === 'votacao') {
            // votos: { categoria: { jogadorId: true/false } }
            for (let cat in votos) {
                if (!sala.votosRodada[cat]) sala.votosRodada[cat] = {};
                for (let jId in votos[cat]) {
                    if (!sala.votosRodada[cat][jId]) sala.votosRodada[cat][jId] = { validos: 0, invalidos: 0 };
                    if (votos[cat][jId] === true) sala.votosRodada[cat][jId].validos++;
                    else sala.votosRodada[cat][jId].invalidos++;
                }
            }

            calcularPontuacaoFinais(roomCode);
        }
    });

    function calcularPontuacaoFinais(roomCode) {
        const sala = salas[roomCode];
        if (!sala) return;

        const pontosGanhosNestaRodada = {};
        sala.jogadores.forEach(p => pontosGanhosNestaRodada[p.id] = 0);

        // Para cada categoria ativa, verificar repetição e validade
        sala.categoriasAtivas.forEach(cat => {
            const contagemPalavras = {};
            
            // 1. Filtrar palavras válidas baseadas na votação ou regras básicas (letra inicial)
            sala.jogadores.forEach(p => {
                const respostasJogador = sala.respostasRodada[p.id] || {};
                let palavra = (respostasJogador[cat] || "").trim().toUpperCase();

                if (palavra && palavra.startsWith(sala.letraAtual)) {
                    // Se houve votação e a maioria rejeitou, invalida
                    if (sala.config.votacaoAtiva && sala.votosRodada[cat] && sala.votosRodada[cat][p.id]) {
                        const v = sala.votosRodada[cat][p.id];
                        if (v.invalidos >= v.validos && v.invalidos > 0) {
                            palavra = ""; // Invalidada
                        }
                    }

                    if (palavra) {
                        contagemPalavras[palavra] = (contagemPalavras[palavra] || 0) + 1;
                    }
                }
            });

            // 2. Distribuir os pontos conforme repetição
            sala.jogadores.forEach(p => {
                const respostasJogador = sala.respostasRodada[p.id] || {};
                const palavra = (respostasJogador[cat] || "").trim().toUpperCase();

                if (palavra && contagemPalavras[palavra]) {
                    if (contagemPalavras[palavra] === 1) {
                        p.pontos += sala.config.pontosNormal;
                        pontosGanhosNestaRodada[p.id] += sala.config.pontosNormal;
                    } else {
                        p.pontos += sala.config.pontosRepetida;
                        pontosGanhosNestaRodada[p.id] += sala.config.pontosRepetida;
                    }
                }
            });
        });

        sala.status = 'resultados';
        io.to(roomCode).emit('mostrarResultados', {
            sala: sala,
            pontosRodada: pontosGanhosNestaRodada,
            respostas: sala.respostasRodada
        });
    }

    socket.on('disconnect', () => {
        for (let codigo in salas) {
            const sala = salas[codigo];
            sala.jogadores = sala.jogadores.filter(p => p.id !== socket.id);
            if (sala.jogadores.length === 0) {
                delete salas[codigo];
            } else {
                if (sala.donoId === socket.id) {
                    sala.donoId = sala.jogadores[0].id;
                }
                io.to(codigo).emit('atualizarSala', sala);
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`Servidor na porta ${PORT}`));
                    
