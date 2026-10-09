FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
COPY linkedin-session-worker/package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY linkedin-session-worker/server.mjs ./
USER pwuser
EXPOSE 8081
CMD ["node", "server.mjs"]
