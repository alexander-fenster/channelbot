FROM node:24-alpine

RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng

WORKDIR /root

COPY . .
RUN npm ci

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT [ "npm", "start" ]
