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

  let response = '';
  for (const file of files10) {
    const content = (
      await fs.promises.readFile(path.join('logs', file))
    ).toString();
    const json = JSON.parse(content);
    delete json.fromUser;
    response += JSON.stringify(json, null, 2) + '\n';
  }

  res.end(response);
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
