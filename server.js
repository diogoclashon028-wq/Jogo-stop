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

// Lista de temas padrão que o dono pode ligar/desligar
const TEMAS_PADRAO = ["Nome", "Animal", "Fruta", "Cor", "Objeto", "Cidade/Estado/País", "Profissão", "Filme/Série"];

// Função de embaralhamento ultra aleatório (Fisher-Yates)
function embaralharTemas(lista) {
    let copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    socket.on('criarSala', (nome) => {
        if (!nome) return;
        const codigo = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        // Inicializa a sala com os temas padrão ativados
        const temasIniciais = TEMAS_PADRAO.map(t => ({ nome: t, ativo: true }));

        salas[codigo] = {
            codigo: codigo,
            donoId: socket.id,
            jogadores: [{ id: socket.id, nome: nome, pontos: 0 }],
            status: 'lobby',
            letraAtual: '',
            temas: temasIniciais,
            config: {
                tempo: 60,
                totalRodadas: 5,
                pontosNormal: 10,
                pontosRepetida: 5,
                limiteJogadores: 8,
                qtdGanhadores: 1
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

    socket.on('salvarConfiguracoes', ({ roomCode, novaConfig }) => {
        if (salas[roomCode] && salas[roomCode].donoId === socket.id) {
            salas[roomCode].config = { ...salas[roomCode].config, ...novaConfig };
            io.to(roomCode).emit('atualizarSala', salas[roomCode]);
        }
    });

    // Alternar ativação de um tema específica
    socket.on('alternarTema', ({ roomCode, index }) => {
        if (salas[roomCode] && salas[roomCode].donoId === socket.id) {
            salas[roomCode].temas
            
