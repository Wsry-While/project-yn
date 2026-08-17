import { createServer } from 'http';
import { parse as parseQuery } from 'querystring';
import type { IncomingMessage } from 'http';
import type { UrlWithParsedQuery } from 'url';
import next from 'next';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || '127.0.0.1';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function parseRequestUrl(req: IncomingMessage): UrlWithParsedQuery {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${hostname}:${port}`}`);

  return {
    protocol: null,
    slashes: null,
    auth: null,
    host: null,
    port: null,
    hostname: null,
    hash: url.hash || null,
    search: url.search || null,
    query: parseQuery(url.searchParams.toString()),
    pathname: url.pathname,
    path: `${url.pathname}${url.search}`,
    href: `${url.pathname}${url.search}${url.hash}`,
  };
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parseRequestUrl(req);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
  });
});
