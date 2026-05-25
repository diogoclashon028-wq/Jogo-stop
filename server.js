const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { 
    cors: { origin: "*" } 
});
const path = require('path');

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const salas = {};

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
            respostas: {},
            rodadaAtual: 0,
            config: {
                tempo: 60,
                pontosPorPalavra: 10,
                totalRodadas: 5,
                limiteJogadores: 8,
                votacaoAtiva: true,
                qtdVencedores: 3,
                regrasRepetidas: 'metade', 
                categorias: [
                    { nome: 'Nome', ativa: true },
                    { nome: 'Animal', ativa: true },
                    { nome: 'Objeto', ativa: true },
                    { nome: 'Cor', ativa: true },
                    { nome: 'Fruta', ativa: true }
                ]
            }
        };
        socket.join(codigo);
        socket.emit('salaCriada', codigo);
        io.to(codigo).emit('atualizarSala', salas[codigo]);
    });

    socket.on('salvarConfiguracoes', ({ roomCode, novaConfig }) => {
        if (salas[roomCode] && salas[roomCode].donoId === socket.id) {
            salas[roomCode].config = { ...salas[roomCode].config, ...novaConfig };
            io.to(roomCode).emit('atualizarSala', salas[roomCode]);
        }
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

    socket.on('expulsarJogador', ({ roomCode, idParaExpulsar }) => {
        if (salas[roomCode] && salas[roomCode].donoId === socket.id) {
            salas[roomCode].jogadores = salas[roomCode].jogadores.filter(p => p.id !== idParaExpulsar);
            io.to(idParaExpulsar).emit('fuiExpulsado');
            io.to(roomCode).emit('atualizarSala', salas[roomCode]);
        }
    });

    socket.on('digitandoRespostas', ({ roomCode, respostas }) => {
        if (salas[roomCode] && salas[roomCode].status === 'jogando') {
            socket.to(roomCode).emit('espiarJogador', { id: socket.id, respostas });
        }
    });

    socket.on('startRound', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.donoId === socket.id) {
            if (sala.rodadaAtual >= sala.config.totalRodadas) {
                sala.status = 'podio';
                io.to(codigo).emit('mostrarPodioFinal', sala);
                return;
            }
            sala.status = 'jogando';
            sala.rodadaAtual++;
            sala.respostas = {};
            
            const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const letra = letras[Math.floor(Math.random() * letras.length)];
            sala.letraAtual = letra;
            io.to(codigo).emit('rodadaIniciada', { letra, config: sala.config, rodadaAtual: sala.rodadaAtual });
        }
    });

    socket.on('pressStop', ({ roomCode, respostas }) => {
        const sala = salas[roomCode];
        if (sala && sala.status === 'jogando') {
            sala.status = 'fim';
            sala.respostas[socket.id] = respostas;
            io.to(roomCode).emit('jogoParado', {
                respostas: sala.respostas,
                quemParou: socket.id,
                votacaoAtiva: sala.config.votacaoAtiva
            });
        }
    });

    socket.on('enviarRespostasRestantes', ({ roomCode, respostas }) => {
        if (salas[roomCode]) {
            salas[roomCode].respostas[socket.id] = respostas;
            io.to(roomCode).emit('atualizarRespostasFinais', salas[roomCode].respostas);
        }
    });

    socket.on('atualizarPontos', ({ roomCode, pontosAtualizados }) => {
        const sala = salas[roomCode];
        if (sala && sala.donoId === socket.id) {
            sala.jogadores.forEach(j => {
                if (pontosAtualizados[j.id] !== undefined) {
                    j.pontos = (j.pontos || 0) + pontosAtualizados[j.id];
                }
            });
            sala.status = 'lobby';
            io.to(roomCode).emit('pontuacaoAtualizada', sala);
        }
    });

    socket.on('reiniciarJogoCompleto', (roomCode) => {
        const sala = salas[roomCode];
        if (sala && sala.donoId === socket.id) {
            sala.jogadores.forEach(j => j.pontos = 0);
            sala.rodadaAtual = 0;
            sala.status = 'lobby';
            io.to(roomCode).emit('pontuacaoAtualizada', sala);
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuário desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`Servidor rodando na porta ${PORT}`));
