FROM node:20-alpine

# ffmpeg is used for all video stitching
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3070

CMD ["node", "src/index.js"]
