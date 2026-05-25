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
const alfabetoCompleto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

io.on('connection', (socket) => {
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
            categoriasDisponiveis: [...categoriasPadrao], 
            categoriasAtivas: [...categoriasPadrao],     
            letrasAtivas: [...alfabetoCompleto],
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

    socket.on('atualizarLetrasAtivas', ({ roomCode, letrasSelecionadas }) => {
        const sala = salas[roomCode];
        if (sala && sala.donoId === socket.id && letrasSelecionadas) {
            sala.letrasAtivas = letrasSelecionadas;
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
        if (sala && sala.donoId === socket.id) {
            if (sala.categoriasAtivas.length === 0) {
                return io.to(sala.donoId).emit('erro', 'Marque pelo menos uma palavra para jogar!');
            }
            if (!sala.letrasAtivas || sala.letrasAtivas.length === 0) {
                return io.to(sala.donoId).emit('erro', 'Selecione pelo menos uma letra para o sorteio!');
            }
            
            sala.status = 'jogando';
            sala.rodadaAtual++;
            sala.tempoRestante = sala.config.tempo;

            const letraSorteada = sala.letrasAtivas[Math.floor(Math.random() * sala.letrasAtivas.length)];
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

            clearInterval(sala.intervaloTempo);
            sala.intervaloTempo = setInterval(() => {
                sala.tempoRestante--;
                io.to(codigo).emit('tempoRestante', sala.tempoRestante);
                
                if (sala.tempoRestante <= 0) {
                    clearInterval(sala.intervaloTempo);
                    sala.status = 'validacao';
                    io.to(codigo).emit('alguemBateuStop', 'Tempo Esgotado');
                }
            }, 1000);
        }
    });

    socket.on('baterStop', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.status === 'jogando') {
            clearInterval(sala.intervaloTempo);
            sala.status = 'validacao';
            const jogadorQueBateu = sala.jogadores.find(j => j.id === socket.id);
            const nome = jogadorQueBateu ? jogadorQueBateu.nome : 'Alguém';
            io.to(codigo).emit('alguemBateuStop', nome);
        }
    });

    socket.on('disconnect', () => {
        for (const codigo in salas) {
            const sala = salas[codigo];
            sala.jogadores = sala.jogadores.filter(p => p.id !== socket.id);
            if (sala.jogadores.length === 0) {
                clearInterval(sala.intervaloTempo);
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
http.listen(PORT, '0.0.0.0', () => console.log(`Servidor rodando na porta ${PORT}`));
                
