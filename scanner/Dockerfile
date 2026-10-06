FROM node:22-bookworm-slim
WORKDIR /app
COPY scanner/package.json scanner/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY cv-extraction-worker.mjs ./
COPY netlify/functions/cv-extract-worker.js ./netlify/functions/
COPY scanner/*.js scanner/*.mjs ./scanner/
COPY netlify/functions/_shared/execution.js netlify/functions/_shared/r2.js netlify/functions/_shared/cv-extraction.js ./netlify/functions/_shared/
COPY src/cvParser.js src/cvEvidence.js src/taxonomy.js ./src/
USER node
CMD ["node", "scanner/run.mjs"]
