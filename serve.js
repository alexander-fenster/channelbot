const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 5001;

const server = http.createServer(async (req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    const files = await fs.promises.readdir('./logs');
    files.sort();

    const files10 = files.slice(-10);

    response = '';
    for (const file of files10) {
        response += (await fs.promises.readFile(path.join('logs', file))).toString() + '\n';
    }

    res.end(response);
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});
