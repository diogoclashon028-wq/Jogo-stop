const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
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
            config: {
                tempo: 60,
                totalRodadas: 5,
                pontosNormal: 10,
                pontosRepetida: 5,
                limiteJogadores: 8
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

    // Evento para sincronizar as configurações salvas pelo Dono
    socket.on('salvarConfiguracoes', ({ roomCode, novaConfig }) => {
        if (salas[roomCode] && salas[roomCode].donoId === socket.id) {
            salas[roomCode].config = { ...salas[roomCode].config, ...novaConfig };
            io.to(roomCode).emit('atualizarSala', salas[roomCode]);
        }
    });

    // Evento para o Dono iniciar a partida
    socket.on('startRound', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.donoId === socket.id) {
            sala.status = 'jogando';
            const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const letraSorteada = letras[Math.floor(Math.random() * letras.length)];
            sala.letraAtual = letraSorteada;
            io.to(codigo).emit('rodadaIniciada', { letra: letraSorteada, config: sala.config });
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuário desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`Servidor rodando na porta ${PORT}`));
