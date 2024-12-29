# Use the official Node.js 18 image as the base image
FROM node:22

# Set the working directory in the container
WORKDIR /app

# Install pnpm globally
RUN ["npm", "install", "-g", "pnpm"]

# Copy the package.json and pnpm-lock.yaml files to the working directory
COPY package.json pnpm-lock.yaml ./

# Install the dependencies using pnpm
RUN ["pnpm", "install", "--frozen-lockfile"]

# Copy the rest of the application code to the working directory
COPY . .

# Build the application
RUN ["pnpm", "build"]

# Start the application
CMD ["node", "--env-file=.env",  "--env-file=.env.local", ".", "schedule"]
