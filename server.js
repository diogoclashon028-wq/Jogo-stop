const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const path = require('path');

app.use(express.static(path.join(__dirname, '')));

const salas = {};

function gerarCodigo() {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let resultado = '';
    for (let i = 0; i < 4; i++) {
        resultado += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    return resultado;
}

io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    socket.on('criarSala', (nomeHost) => {
        const codigo = gerarCodigo();
        salas[codigo] = {
            code: codigo,
            host: socket.id,
            players: [{ id: socket.id, name: nomeHost, points: 0 }],
            categories: ['Nome', 'Animal', 'Objeto', 'Fruta'],
            status: 'lobby'
        };
        socket.join(codigo);
        socket.emit('salaCriada', codigo);
        io.to(codigo).emit('roomUpdated', salas[codigo]);
    });

    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        const sala = salas[codigo];
        if (!sala) return socket.emit('erro', 'Sala não encontrada!');

        sala.players.push({ id: socket.id, name: name, points: 0 });
        socket.join(codigo);
        io.to(codigo).emit('roomUpdated', sala);
    });

    socket.on('disconnect', () => {
        Object.keys(salas).forEach(codigo => {
            const sala = salas[codigo];
            sala.players = sala.players.filter(p => p.id !== socket.id);
            if (sala.players.length === 0) {
                delete salas[codigo];
            } else {
                io.to(codigo).emit('roomUpdated', sala);
            }
        });
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
