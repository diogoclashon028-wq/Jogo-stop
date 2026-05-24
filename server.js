const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');

// Servir os arquivos estáticos da pasta raiz
app.use(express.static(path.join(__dirname, '')));

const salas = {};

// Função auxiliar para gerar códigos de sala únicos
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

    // 1. CRIAR SALA
    socket.on('criarSala', (nomeHost) => {
        try {
            const codigo = gerarCodigo();
            salas[codigo] = {
                code: codigo,
                host: socket.id,
                players: [{ id: socket.id, name: nomeHost, points: 0, timeTaken: 0 }],
                categories: ['Nome', 'Animal', 'Objeto', 'Fruta'],
                allowedLetters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
                usedLetters: [],
                currentLetter: '',
                roundTime: 60,
                maxRounds: 5,
                currentRound: 0,
                ptsAcerto: 10,
                ptsRepetido: 5,
                maxPlayers: 8,
                gameMode: 'regressiva',
                topWinnersCount: 3, 
                status: 'lobby',
                respostasRodada: {},
                votosContagem: {} 
            };
            socket.join(codigo);
            socket.emit('salaCriada', codigo);
            io.to(codigo).emit('roomUpdated', salas[codigo]);
        } catch (err) {
            console.error("Erro ao criar sala:", err);
        }
    });

    // 2. ENTRAR NA SALA
    socket.on('joinRoom', ({ roomCode, name }) => {
        try {
            const codigo = roomCode.toUpperCase();
            const sala = salas[codigo];
            if (!sala) return socket.emit('erro', 'Sala não encontrada!');
            if (sala.status !== 'lobby') return socket.emit('erro', 'O jogo já começou!');
            if (sala.players.length >= (sala.maxPlayers || 8)) return socket.emit('erro', 'A sala está cheia!');

            sala.players.push({ id: socket.id, name: name, points: 0, timeTaken: 0 });
            socket.join(codigo);
            io.to(codigo).emit('roomUpdated', sala);
        } catch (err) {
            console.error("Erro ao entrar na sala:", err);
        }
    });

    // 3. SINCRONIZAR CONFIGURAÇÕES EM TEMPO REAL
    socket.on('updateSettings', (config) => {
        try {
            const sala = Object.values(salas).find(s => s.host === socket.id);
            if (!sala) return;

            sala.roundTime = parseInt(config.roundTime) || 60;
            sala.maxRounds = parseInt(config.maxRounds) || 5;
            sala.ptsAcerto = parseInt(config.ptsAcerto) || 10;
            sala.ptsRepetido = parseInt(config.ptsRepetido) || 5;
            sala.maxPlayers = parseInt(config.maxPlayers) || 8;
            sala.gameMode = config.gameMode || 'regressiva';
            sala.topWinnersCount = parseInt(config.topWinnersCount) || 3;

            io.to(sala.code).emit('roomUpdated', sala);
        } catch (err) {
            console.error("Erro ao atualizar configurações:", err);
        }
    });

    // 4. GERENCIAR TEMAS (ADICIONAR/REMOVER)
    socket.on('addCategory', (categoria) => {
        try {
            const sala = Object.values(salas).find(s => s.host === socket.id);
            if (sala && categoria && !sala.categories.includes(categoria)) {
                sala.categories.push(categoria);
                io.to(sala.code).emit('roomUpdated', sala);
            }
        } catch (err) {
            console.error("Erro ao adicionar categoria:", err);
        }
    });

    socket.on('removeCategory', (categoria) => {
        try {
            const sala = Object.values(salas).find(s => s.host === socket.id);
            if (sala) {
                sala.categories = sala.categories.filter(c => c !== categoria);
                io.to(sala.code).emit('roomUpdated', sala);
            }
        } catch (err) {
            console.error("Erro ao remover categoria:", err);
        }
    });

    // 5. FILTRAR LETRAS DO SORTEIO
    socket.on('toggleLetter', (letra) => {
        try {
            const sala = Object.values(salas).find(s => s.host === socket.id);
            if (sala) {
                if (sala.allowedLetters.includes(letra)) {
                    if (sala.allowedLetters.length > 1) {
                        sala.allowedLetters = sala.allowedLetters.filter(l => l !== letra);
                    }
                } else {
                    sala.allowedLetters.push(letra);
                }
                io.to(sala.code).emit('roomUpdated', sala);
            }
        } catch (err) {
            console.error("Erro ao alternar letra:", err);
        }
    });

    // 6. EXPULSAR JOGADOR (KICK)
    socket.on('kickPlayer', (idAlvo) => {
        try {
            const sala = Object.values(salas).find(s => s.host === socket.id);
            if (!sala) return;
            
            sala.players = sala.players.filter(p => p.id !== idAlvo);
            io.to(idAlvo).emit('playerKicked');
            
            const socketAlvo = io.sockets.sockets.get(idAlvo);
            if (socketAlvo) socketAlvo.leave(sala.code);

            io.to(sala.code).emit('roomUpdated', sala);
        } catch (err) {
            console.error("Erro ao expulsar jogador:", err);
        }
    });

    // 7. INICIAR RODADA
    socket.on('startRound', () => {
        try {
            const sala = Object.values(salas).find(s => s.host === socket.id);
            if (!sala) return;

            const letrasDisponiveis = sala.allowedLetters.filter(l => !sala.usedLetters.includes(l));
            if (letrasDisponiveis.length === 0) sala.usedLetters = []; 
            
            const listaSorteio = letrasDisponiveis.length > 0 ? letrasDisponiveis : sala.allowedLetters;
            const letraEscolhida = listaSorteio[Math.floor(Math.random() * listaSorteio.length)];
            
            sala.usedLetters.push(letraEscolhida);
            sala.currentLetter = letraEscolhida;
            sala.currentRound++;
            sala.status = 'jogando';
            sala.respostasRodada = {};
            sala.votosContagem = {};

            io.to(sala.code).emit('roundStarted', {
                round: sala.currentRound,
                maxRounds: sala.maxRounds,
                letter: sala.currentLetter,
                categories: sala.categories,
                gameMode: sala.gameMode,
                roundTime: sala.roundTime
            });
        } catch (err) {
            console.error("Erro ao iniciar rodada:", err);
        }
    });

    // 8. NOTIFICAR QUEM DEU STOP
    socket.on('notifyStop', () => {
        try {
            const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
            if (!sala || sala.status !== 'jogando') return;

            const jogador = sala.players.find(p => p.id === socket.id);
            if (jogador) {
                io.to(sala.code).emit('playerPressedStop', { nome: jogador.name, id: socket.id });
            }
        } catch (err) {
            console.error("Erro ao notificar stop:", err);
        }
    });

    // 9. RECEBER RESPOSTAS INDIVIDUAIS
    socket.on('pressStop', (dados) => {
        try {
            const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
            if (!sala) return;

            sala.respostasRodada[socket.id] = {
                respostas: dados.respostas || {},
                timeTaken: dados.timeTaken || 0,
                playerName: sala.players.find(p => p.id === socket.id)?.name || 'Anônimo'
            };

            const jogador = sala.players.find(p => p.id === socket.id);
            if (jogador) jogador.timeTaken = dados.timeTaken || 0;

            const todosResponderam = sala.players.every(p => sala.respostasRodada[p.id] !== undefined);

            // Se todos enviaram, ou se o modo for clássico (fim imediato), abre a votação
            if (todosResponderam || sala.gameMode === 'classico') {
                sala.status = 'votacao';
                io.to(sala.code).emit('abrirVotacao', {
                    respostas: sala.respostasRodada,
                    categories: sala.categories,
                    letter: sala.currentLetter
                });
            }
        } catch (err) {
            console.error("Erro ao processar parada de rodada:", err);
        }
    });

    // 10. CONTABILIZAR OS VOTOS DA LUPA/AVALIAÇÃO
    socket.on('computarVotos', (votosInvalidos) => {
        try {
            const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
            if (!sala) return;

            sala.votosContagem[socket.id] = votosInvalidos; 

            const todosVotaram = sala.players.every(p => sala.votosContagem[p.id] !== undefined);
            if (todosVotaram) {
                processarPontosRodada(sala);
            }
        } catch (err) {
            console.error("Erro ao processar computação de votos:", err);
        }
    });

    // SISTEMA DE PONTUAÇÃO CORRIGIDO E SEGURO
    function processarPontosRodada(sala) {
        try {
            const totalVotantes = sala.players.length;
            if (totalVotantes === 0) return;

            const rejeitadas = {}; 

            // Junta os votos de invalidação enviados por todos da sala
            Object.values(sala.votosContagem).forEach(listaRejeicao => {
                if (Array.isArray(listaRejeicao)) {
                    listaRejeicao.forEach(chave => {
                        rejeitadas[chave] = (rejeitadas[chave] || 0) + 1;
                    });
                }
            });

            // Avalia palavra por palavra dentro de cada categoria ativa
            sala.categories.forEach(cat => {
                const palavrasValidasDessaCategoria = {};

                sala.players.forEach(p => {
                    const dadosUser = sala.respostasRodada[p.id];
                    if (!dadosUser || !dadosUser.respostas || !dadosUser.respostas[cat]) return;

                    const palavra = dadosUser.respostas[cat].trim().toUpperCase();
                    const chaveVoto = `${p.id}-${cat}`;
                    const votosContra = rejeitadas[chaveVoto] || 0;

                    // Critérios: Não vazia + começar com a letra + ter menos que 50% de rejeição da sala
                    if (palavra.length > 0 && palavra.startsWith(sala.currentLetter.toUpperCase()) && votosContra < (totalVotantes / 2)) {
                        palavrasValidasDessaCategoria[palavra] = palavrasValidasDessaCategoria[palavra] || [];
                        palavrasValidasDessaCategoria[palavra].push(p.id);
                    }
                });

                // Atribuição Dinâmica dos Pontos (Único vs Repetido)
                Object.keys(palavrasValidasDessaCategoria).forEach(palavra => {
                    const idsJogadores = palavrasValidasDessaCategoria[palavra];
                    if (idsJogadores.length === 1) {
                        const jogador = sala.players.find(p => p.id === idsJogadores[0]);
                        if (jogador) jogador.points += (sala.ptsAcerto || 10);
                    } else {
                        idsJogadores.forEach(id => {
                            const jogador = sala.players.find(p => p.id === id);
                            if (jogador) jogador.points += (sala.ptsRepetido || 5);
                        });
                    }
                });
            });

            // Verificação de Fim de Jogo ou Próxima Rodada
            if (sala.currentRound >= sala.maxRounds) {
                sala.status = 'final';
                const ranking = [...sala.players].sort((a,b) => b.points - a.points);
                const podio = ranking.slice(0, sala.topWinnersCount || 3);
                io.to(sala.code).emit('fimDeJogo', { ranking: ranking, podio: podio });
            } else {
                sala.status = 'lobby';
                sala.respostasRodada = {};
                sala.votosContagem = {};
                io.to(sala.code).emit('roomUpdated', sala);
            }
        } catch (err) {
            console.error("Erro fatal ao processar os pontos:", err);
        }
    }

    // DESCONEXÃO SEM QUEBRAR O FLUXO DA SALA
    socket.on('disconnect', () => {
        try {
            Object.keys(salas).forEach(codigo => {
                const sala = salas[codigo];
                if (!sala) return;

                const jogadorExiste = sala.players.some(p => p.id === socket.id);
                if (!jogadorExiste) return;

                sala.players = sala.players.filter(p => p.id !== socket.id);
                
                if (sala.players.length === 0) {
                    delete salas[codigo];
                } else {
                    if (sala.host === socket.id) {
                        sala.host = sala.players[0].id;
                    }
                    // Se a sala estava em votação, remove o player pendente e checa se encerra
                    if (sala.status === 'votacao') {
                        delete sala.votosContagem[socket.id];
                        const todosVotaram = sala.players.every(p => sala.votosContagem[p.id] !== undefined);
                        if (todosVotaram) {
                            processarPontosRodada(sala);
                            return;
                        }
                    }
                    io.to(codigo).emit('roomUpdated', sala);
                }
            });
        } catch (err) {
            console.error("Erro na desconexão:", err);
        }
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
                    
