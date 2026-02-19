FROM nginx:1.27-alpine

# Serve this repository as static content.
COPY . /usr/share/nginx/html
