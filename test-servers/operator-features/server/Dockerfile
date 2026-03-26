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
# Use ENTRYPOINT so that arguments from Kubernetes spec.config.arguments
# are passed as args to the script, not used to replace the command
ENTRYPOINT ["./index.js"]