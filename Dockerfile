FROM node:20-alpine

WORKDIR /usr/src/app

# Install runtime dependencies (use npm install to work without package-lock)
COPY package*.json ./
RUN npm install --production --silent

# Copy app sources
COPY . .

# Use non-root node user from base image
USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/health || exit 1

CMD [ "node", "src/server.js" ]
