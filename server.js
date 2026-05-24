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
            letraAtual: '',
            respostas: {},
            historicoRodadas: []
        };
        socket.join(codigo);
        socket.emit('salaCriada', codigo);
        io.to(codigo).emit('atualizarSala', salas[codigo]);
    });

    // Entrar na Sala
    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        if (salas[codigo]) {
            // Evita duplicar o mesmo jogador se reconectar
            const jaExiste = salas[codigo].jogadores.find(p => p.id === socket.id);
            if (!jaExiste) {
                salas[codigo].jogadores.push({ id: socket.id, nome: name, pontos: 0 });
            }
            socket.join(codigo);
            io.to(codigo).emit('atualizarSala', salas[codigo]);
        } else {
            socket.emit('erro', 'Sala não encontrada');
        }
    });

    // Iniciar Rodada
    socket.on('startRound', (codigo) => {
        if (salas[codigo]) {
            salas[codigo].status = 'jogando';
            salas[codigo].respostas = {};
            const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const letra = letras[Math.floor(Math.random() * letras.length)];
            salas[codigo].letraAtual = letra;
            io.to(codigo).emit('rodadaIniciada', letra);
        }
    });

    // Botão de Stop pressionado
    socket.on('pressStop', ({ roomCode, respostas }) => {
        if (salas[roomCode] && salas[roomCode].status === 'jogando') {
            salas[roomCode].status = 'fim';
            salas[roomCode].respostas[socket.id] = respostas;
            io.to(roomCode).emit('jogoParado', {
                respostas: salas[roomCode].respostas,
                quemParou: socket.id
            });
        }
    });

    // Enviar respostas restantes (para quem não apertou stop)
    socket.on('enviarRespostasRestantes', ({ roomCode, respostas }) => {
        if (salas[roomCode]) {
            salas[roomCode].respostas[socket.id] = respostas;
            io.to(roomCode).emit('atualizarRespostasFinais', salas[roomCode].respostas);
        }
    });

    // Atualizar Pontuação após validação/revisão
    socket.on('atualizarPontos', ({ roomCode, pontosAtualizados }) => {
        if (salas[roomCode]) {
            salas[roomCode].jogadores.forEach(j => {
                if (pontosAtualizados[j.id] !== undefined) {
                    j.pontos += pontosAtualizados[j.id];
                }
            });
            salas[roomCode].status = 'lobby';
            io.to(roomCode).emit('pontuacaoAtualizada', salas[roomCode]);
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuário desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`Servidor rodando na porta ${PORT}`));

