const fs = require('fs');
const path = require('path');

// Função que varre as pastas procurando o seu server.js automaticamente
function acharServer(dir) {
    const arquivos = fs.readdirSync(dir);
    for (const arquivo of arquivos) {
        const caminhoCompleto = path.join(dir, arquivo);
        if (arquivo === 'node_modules' || arquivo === '.git') continue;
        
        if (fs.statSync(caminhoCompleto).isDirectory()) {
            const achado = acharServer(caminhoCompleto);
            if (achado) return achado;
        } else if (arquivo === 'server.js') {
            return caminhoCompleto;
        }
    }
    return null;
}

const caminhoDoServer = acharServer(__dirname);

if (caminhoDoServer) {
    console.log(`-> Servidor localizado com sucesso em: ${caminhoDoServer}`);
    require(caminhoDoServer);
} else {
    console.error("-> ERRO CRÍTICO: O arquivo server.js não foi encontrado em nenhuma pasta!");
    process.exit(1);
}
