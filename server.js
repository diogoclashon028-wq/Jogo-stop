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

    socket.on('criarSala', ({ nome, usuarioId }) => {
        if (!nome || !usuarioId) return;
        const codigo = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        salas[codigo] = {
            codigo: codigo,
            donoId: usuarioId, 
            jogadores: [{ id: socket.id, usuarioId: usuarioId, nome: nome, pontos: 0 }],
            status: 'lobby',
            letraAtual: '',
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
            
            // Tratamento de reconexão automática se o ID persistente já existe
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

    socket.on('atualizarCategoriasAtivas', ({ roomCode, categoriasSelecionadas }) => {
        const sala = salas[roomCode];
        if (sala && categoriasSelecionadas) {
            const jogador = sala.jogadores.find(p => p.id === socket.id);
            if (jogador && jogador.usuarioId === sala.donoId) {
                sala.categoriasAtivas = categoriasSelecionadas;
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
                    io.to(alvo.id).emit('mensagemExpulso', 'você foi expulso');
                    const targetSocket = io.sockets.sockets.get(alvo.id);
                    if (targetSocket) targetSocket.leave(roomCode);
                    io.to(roomCode).emit('atualizarSala', sala);
                }
            }
        }
    });

    socket.on('startRound', (codigo) => {
        const sala = salas[codigo];
        if (sala) {
            const jogador = sala.jogadores.find(p => p.id === socket.id);
            if (jogador && jogador.usuarioId === sala.donoId) {
                if (sala.categoriasAtivas.length === 0) {
                    return socket.emit('erro', 'Marque pelo menos uma palavra para jogar!');
                }
                sala.status = 'jogando';
                const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                const letraSorteada = letras[Math.floor(Math.random() * letras.length)];
                sala.letraAtual = letraSorteada;

                let categoriasEmbaralhadas = [...sala.categoriasAtivas];
                for (let i = categoriasEmbaralhadas.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [categoriasEmbaralhadas[i], categoriasEmbaralhadas[j]] = [categoriasEmbaralhadas[j], categoriasEmbaralhadas[i]]; 
                }

                io.to(codigo).emit('rodadaIniciada', { 
                    letra: letraSorteada, 
                    config: sala.config,
                    categoriasOrdem: categoriasEmbaralhadas
                });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuário desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`Servidor rodando na porta ${PORT}`));
                                     
