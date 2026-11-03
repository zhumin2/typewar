# TypeWar 服务端（Go）多阶段构建
#   docker build -t typewar .
#   docker run -p 3000:3000 typewar

FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY server/ ./server/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/typewar ./server

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/typewar /app/typewar
COPY public/ /app/public/
ENV PORT=3000
EXPOSE 3000
# 容器内需要监听 0.0.0.0，否则宿主机映射不到
CMD ["/app/typewar", "-addr", ":3000", "-dir", "/app/public"]
