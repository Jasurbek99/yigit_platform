FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
# `vite build`, NOT `npm run build` (= `tsc && vite build`). The beta host
# (10.10.11.25) has 3.8 GB RAM with ~1.3 GB free; a whole-program `tsc` over
# ~490 files needs 1.5-4 GB resident, so the box thrashes swap: this step was
# measured at 683s on 2026-08-27, the bulk of a 76-minute `update.sh` run.
# Typechecking stays a LOCAL gate (`npx tsc --noEmit --ignoreDeprecations 5.0`),
# which is where a type error should surface anyway, not mid-deploy.
RUN npx vite build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
