const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const path = require('path');

app.use(express.static(path.join(__dirname, '')));

const salas = {};

io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    // Criar Sala
    socket.on('criarSala', (nome) => {
        const codigo = Math.random().toString(36).substring(2, 6).toUpperCase();
        salas[codigo] = {
            codigo: codigo,
            jogadores: [{ id: socket.id, nome: nome, pontos: 0 }],
            status: 'lobby',
            respostas: {}
        };
        socket.join(codigo);
        socket.emit('salaCriada', codigo);
        io.to(codigo).emit('atualizarSala', salas[codigo]);
    });

    // Entrar na Sala
    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        if (salas[codigo]) {
            salas[codigo].jogadores.push({ id: socket.id, nome: name, pontos: 0 });
            socket.join(codigo);
            io.to(codigo).emit('atualizarSala', salas[codigo]);
        } else {
            socket.emit('erro', 'Sala não encontrada');
        }
    });

    // Iniciar Jogo
    socket.on('startRound', (codigo) => {
        if (salas[codigo]) {
            salas[codigo].status = 'jogando';
            salas[codigo].respostas = {};
            const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const letra = letras[Math.floor(Math.random() * letras.length)];
            io.to(codigo).emit('rodadaIniciada', letra);
        }
    });

    // Botão de Stop
    socket.on('pressStop', ({ roomCode, respostas }) => {
        if (salas[roomCode]) {
            salas[roomCode].respostas[socket.id] = respostas;
            salas[roomCode].status = 'fim';
            io.to(roomCode).emit('jogoParado', salas[roomCode].respostas);
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuário desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`Servidor rodando na porta ${PORT}`));
