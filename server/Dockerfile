FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN npm test
RUN chmod +x docker-entrypoint.sh && mkdir -p uploads
# Railway mounts /app/uploads as a persistent volume at runtime. The mounted
# directory is owned by root, so the container must be able to write to it.
# Keep the runtime root user to allow multer to create uploaded files there.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/readyz || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
