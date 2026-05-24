const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');

app.use(express.static(path.join(__dirname, '')));

const salas = {};

io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    // Envia sinal de conexão bem-sucedida para ativar a bolinha verde
    socket.emit('statusConexao', true);

    // Criar Sala (O criador vira o Dono)
    socket.on('criarSala', (nome) => {
        const codigo = Math.random().toString(36).substring(2, 6).toUpperCase();
        salas[codigo] = {
            codigo: codigo,
            donoId: socket.id,
            jogadores: [{ id: socket.id, nome: nome, pontos: 0 }],
            status: 'lobby',
            letraAtual: '',
            respostas: {},
            rodadaAtual: 0,
            // Configurações do Dono
            config: {
                tempo: 60,
                pontosPorPalavra: 10,
                totalRodadas: 5,
                modo: 'classico',
                categorias: ['Nome', 'Animal', 'Objeto', 'Cor', 'Fruta'],
                votacaoAtiva: true,
                qtdVencedores: 1,
                limiteJogadores: 8
            }
        };
        socket.join(codigo);
        socket.emit('salaCriada', codigo);
        io.to(codigo).emit('atualizarSala', salas[codigo]);
    });

    // Dono altera configurações em tempo real no Lobby
    socket.on('salvarConfiguracoes', ({ roomCode, novaConfig }) => {
        if (salas[roomCode] && salas[roomCode].donoId === socket.id) {
            salas[roomCode].config = { ...salas[roomCode].config, ...novaConfig };
            io.to(roomCode).emit('atualizarSala', salas[roomCode]);
        }
    });

    // Entrar na Sala
    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        if (salas[codigo]) {
            const sala = salas[codigo];
            if (sala.jogadores.length >= sala.config.limiteJogadores) {
                return socket.emit('erro', 'A sala já está cheia!');
            }
            const jaExiste = sala.jogadores.find(p => p.id === socket.id);
            if (!jaExiste) {
                sala.jogadores.push({ id: socket.id, nome: name, pontos: 0 });
            }
            socket.join(codigo);
            io.to(codigo).emit('atualizarSala', sala);
        } else {
            socket.emit('erro', 'Sala não encontrada');
        }
    });

    // Atualização do que a pessoa está digitando (Para a Lupa de Espionagem)
    socket.on('digitandoRespostas', ({ roomCode, respostas }) => {
        if (salas[roomCode] && salas[roomCode].status === 'jogando') {
            socket.to(roomCode).emit('espiarJogador', { id: socket.id, respostas });
        }
    });

    // Iniciar Rodada
    socket.on('startRound', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.donoId === socket.id) {
            if (sala.rodadaAtual >= sala.config.totalRodadas) {
                // Chegou ao fim de todas as rodadas -> Mostrar Classificação Final
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

    // Botão de Stop pressionado ou Tempo Esgotado
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

    // Avançar para próxima rodada ou computar pontos
    socket.on('atualizarPontos', ({ roomCode, pontosAtualizados }) => {
        const sala = salas[roomCode];
        if (sala && sala.donoId === socket.id) {
            sala.jogadores.forEach(j => {
                if (pontosAtualizados[j.id] !== undefined) {
                    j.pontos += pontosAtualizados[j.id];
                }
            });
            sala.status = 'lobby';
            io.to(roomCode).emit('pontuacaoAtualizada', sala);
        }
    });

    // Reiniciar o jogo inteiro do zero
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
