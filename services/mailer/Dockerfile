FROM node:20-alpine

WORKDIR /app

# package.json alone first so `npm ci` is cached independently of index.js —
# this image rebuilds on every mailer edit otherwise.
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY index.js ./

# Drops from root once the install is done. The worker needs no filesystem
# writes and no privileged ports.
USER node

CMD ["node", "index.js"]
