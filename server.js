const express = require('express');
const app = express();
const http = require('http').createServer(app);
// CORREÇÃO: Servidor configurado para aceitar conexão direta do WebSocket 
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket']
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

    socket.on('criarSala', ({ nome, usuarioId }) => {
        if (!nome || !usuarioId) return;
        const codigo = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        salas[codigo] = {
            codigo: codigo,
            donoId: usuarioId, 
            jogadores: [{ id: socket.id, usuarioId: usuarioId, nome: nome, pontos: 0 }],
            status: 'lobby',
            letraAtual: '',
            rodadaAtual: 0,
            respostasRecebidas: {},
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
            }
        };
        socket.join(codigo);
        io.to(codigo).emit('atualizarSala', salas[codigo]);
    });

    socket.on('joinRoom', ({ roomCode, name, usuarioId }) => {
        if (!roomCode || !usuarioId) return;
        const codigo = roomCode.toUpperCase();
        if (salas[codigo]) {
            const sala = salas[codigo];
            
            const jogadorExistente = sala.jogadores.find(p => p.usuarioId === usuarioId);
            if (jogadorExistente) {
                jogadorExistente.id = socket.id;
            } else {
                if (sala.jogadores.length >= sala.config.limiteJogadores) {
                    return socket.emit('erro', 'A sala já está cheia!');
                }
                if (name) {
                    sala.jogadores.push({ id: socket.id, usuarioId: usuarioId, nome: name, pontos: 0 });
                }
            }
            socket.join(codigo);
            io.to(codigo).emit('atualizarSala', sala);
        } else {
            socket.emit('erro', 'Sala não encontrada');
        }
    });

    // CONTROLO DE JOGABILIDADE E LOOP DE RODADAS
    socket.on('startRound', (codigo) => {
        const sala = salas[codigo];
        if (sala) {
            const jogador = sala.jogadores.find(p => p.id === socket.id);
            if (jogador && jogador.usuarioId === sala.donoId) {
                
                if (sala.status === 'resultados' && sala.rodadaAtual >= sala.config.totalRodadas) {
                    sala.status = 'lobby';
                    sala.rodadaAtual = 0;
                    sala.jogadores.forEach(p => p.pontos = 0);
                    io.to(codigo).emit('atualizarSala', sala);
                    return;
                }

                if (sala.categoriasAtivas.length === 0) {
                    return socket.emit('erro', 'Marque pelo menos uma palavra para jogar!');
                }
                
                if (sala.status === 'lobby') {
                    sala.rodadaAtual = 1;
                    sala.jogadores.forEach(p => p.pontos = 0);
                } else if (sala.status === 'resultados') {
                    sala.rodadaAtual++;
                }

                sala.status = 'jogando';
                sala.respostasRecebidas = {};

                const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                sala.letraAtual = letras[Math.floor(Math.random() * letras.length)];

                let categoriasEmbaralhadas = [...sala.categoriasAtivas];
                for (let i = categoriasEmbaralhadas.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [categoriasEmbaralhadas[i], categoriasEmbaralhadas[j]] = [categoriasEmbaralhadas[j], categoriasEmbaralhadas[i]]; 
                }
                sala.categoriasOrdemAtual = categoriasEmbaralhadas;
                sala.tempoRestante = sala.config.tempo;

                io.to(codigo).emit('rodadaIniciada', { 
                    letra: sala.letraAtual, 
                    config: sala.config,
                    categoriasOrdem: sala.categoriasOrdemAtual,
                    rodadaAtual: sala.rodadaAtual,
                    totalRodadas: sala.config.totalRodadas,
                    tempoRestante: sala.tempoRestante
                });

                if (sala.intervaloTimer) clearInterval(sala.intervaloTimer);
                sala.intervaloTimer = setInterval(() => {
                    sala.tempoRestante--;
                    io.to(codigo).emit('atualizarTimer', sala.tempoRestante);
                    
                    if (sala.tempoRestante <= 0) {
                        clearInterval(sala.intervaloTimer);
                        encerrarEColher(codigo);
                    }
                }, 1000);
            }
        }
    });

    socket.on('solicitarStop', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.status === 'jogando') {
            if (sala.intervaloTimer) clearInterval(sala.intervaloTimer);
            encerrarEColher(codigo);
        }
    });

    function encerrarEColher(codigo) {
        const sala = salas[codigo];
        if (!sala || sala.status !== 'jogando') return;
        
        sala.status = 'recolhendo';
        io.to(codigo).emit('recolherRespostas');

        // Delay para garantir a receção das respostas enviadas por redes oscilantes
        setTimeout(() => {
            calcularPontuacaoRodada(codigo);
        }, 2000);
    }

    socket.on('enviarRespostas', ({ roomCode, usuarioId, respostas }) => {
        const sala = salas[roomCode];
        if (sala && (sala.status === 'jogando' || sala.status === 'recolhendo')) {
            sala.respostasRecebidas[usuarioId] = respostas;
        }
    });

    function calcularPontuacaoRodada(codigo) {
        const sala = salas[codigo];
        if (!sala) return;

        sala.status = 'resultados';
        const relatorio = {};
        const letraMinuscula = sala.letraAtual.toLowerCase();

        sala.jogadores.forEach(p => {
            relatorio[p.usuarioId] = { nome: p.nome, pontosGanhos: 0, palavras: {} };
        });

        sala.categoriasOrdemAtual.forEach(cat => {
            const contagemPalavrasValidas = {};

            sala.jogadores.forEach(p => {
                const r = sala.respostasRecebidas[p.usuarioId] || {};
                const palavra = (r[cat] || "").trim().toLowerCase();
                
                if (palavra && palavra.startsWith(letraMinuscula)) {
                    contagemPalavrasValidas[palavra] = (contagemPalavrasValidas[palavra] || 0) + 1;
                }
            });

            sala.jogadores.forEach(p => {
                const r = sala.respostasRecebidas[p.usuarioId] || {};
                const palavraOriginal = r[cat] || "";
                const palavraLimpa = palavraOriginal.trim().toLowerCase();

                let pts = 0;
                if (palavraLimpa && palavraLimpa.startsWith(letraMinuscula)) {
                    if (contagemPalavrasValidas[palavraLimpa] > 1) {
                        pts = sala.config.pontosRepetida;
                    } else {
                        pts = sala.config.pontosNormal;
                    }
                }

                relatorio[p.usuarioId].pontosGanhos += pts;
                relatorio[p.usuarioId].palavras[cat] = { texto: palavraOriginal || "-", pontos: pts };
                p.pontos += pts;
            });
        });

        sala.jogadores.sort((a, b) => b.pontos - a.pontos);
        const ehUltimaRodada = sala.rodadaAtual >= sala.config.totalRodadas;

        io.to(codigo).emit('resultadosDaRodadaExibir', {
            relatorio,
            jogadoresRanking: sala.jogadores,
            categorias: sala.categoriasOrdemAtual,
            rodadaAtual: sala.rodadaAtual,
            ehUltimaRodada
        });
    }

    // GESTÃO DE PALAVRAS E CONFIGURAÇÕES DO LOBBY
    socket.on('adicionarTema', ({ roomCode, novoTema }) => {
        const sala = salas[roomCode];
        if (sala && novoTema) {
            const jogador = sala.jogadores.find(p => p.id === socket.id);
            if (jogador && jogador.usuarioId === sala.donoId) {
                const temaTratado = novoTema.trim();
                if (!sala.categoriasDisponiveis.includes(temaTratado)) {
                    sala.categoriasDisponiveis.push(temaTratado);
                    sala.categoriasAtivas.push(temaTratado); 
                    io.to(roomCode).emit('atualizarSala', sala);
                }
            }
        }
    });

    socket.on('deletarTema', ({ roomCode, tema }) => {
        const sala = salas[roomCode];
        if (sala) {
            const jogador = sala.jogadores.find(p => p.id === socket.id);
            if (jogador && jogador.usuarioId === sala.donoId) {
                sala.categoriasDisponiveis = sala.categoriasDisponiveis.filter(c => c !== tema);
                sala.categoriasAtivas = sala.categoriasAtivas.filter(c => c !== tema);
                io.to(roomCode).emit('atualizarSala', sala);
            }
        }
    });

    socket.on('atualizarCategoriasAtivas', ({ roomCode, categoriesSelecionadas }) => {
        const sala = salas[roomCode];
        if (sala && categoriesSelecionadas) {
            const jogador = sala.jogadores.find(p => p.id === socket.id);
            if (jogador && jogador.usuarioId === sala.donoId) {
                sala.categoriasAtivas = categoriesSelecionadas;
                io.to(roomCode).emit('atualizarSala', sala);
            }
        }
    });

    socket.on('salvarConfiguracoes', ({ roomCode, novaConfig }) => {
        const sala = salas[roomCode];
        if (sala && novaConfig) {
            const jogador = sala.jogadores.find(p => p.id === socket.id);
            if (jogador && jogador.usuarioId === sala.donoId) {
                sala.config = { ...sala.config, ...novaConfig };
                io.to(roomCode).emit('atualizarSala', sala);
            }
        }
    });

    socket.on('expulsarJogador', ({ roomCode, usuarioIdParaExpulsar }) => {
        const sala = salas[roomCode];
        if (sala) {
            const jogadorDono = sala.jogadores.find(p => p.id === socket.id);
            if (jogadorDono && jogadorDono.usuarioId === sala.donoId) {
                const alvo = sala.jogadores.find(p => p.usuarioId === usuarioIdParaExpulsar);
                if (alvo) {
                    sala.jogadores = sala.jogadores.filter(p => p.usuarioId !== usuarioIdParaExpulsar);
                    io.to(alvo.id).emit('mensagemExpulso', 'Você foi expulso da sala.');
                    const targetSocket = io.sockets.sockets.get(alvo.id);
                    if (targetSocket) targetSocket.leave(roomCode);
                    io.to(roomCode).emit('atualizarSala', sala);
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuário desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`Servidor rodando na porta ${PORT}`));
            
