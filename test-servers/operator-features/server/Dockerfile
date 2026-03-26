FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy server code
COPY index.js ./

# Make index.js executable
RUN chmod +x index.js

# Run as non-root user for security
USER node

# Start the server
CMD ["node", "index.js"]