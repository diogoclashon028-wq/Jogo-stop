const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000;

// Avisa ao servidor para entregar os arquivos que estão soltos na mesma pasta
app.use(express.static(__dirname));

// Rota para abrir o jogo direto na página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let salas = {};

io.on('connection', (socket) => {
    console.log('Novo jogador conectado:', socket.id);

    socket.on('criarSala', (nomeSala) => {
        if (!salas[nomeSala]) {
            salas[nomeSala] = { jogadores: [], jogoIniciado: false };
            socket.join(nomeSala);
            salas[nomeSala].jogadores.push(socket.id);
            socket.emit('salaCriada', nomeSala);
            console.log(`Sala ${nomeSala} criada por ${socket.id}`);
        } else {
            socket.emit('erro', 'Sala já existe.');
        }
    });

    socket.on('disconnect', () => {
        console.log('Jogador desconectado:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
