# Use Maven and JDK 21 to build and run the application
FROM maven:3.9-eclipse-temurin-21

WORKDIR /app

# Copy the project files
COPY pom.xml .
# Install asterisk so the container has the CLI tool for add_extension.sh,
# plus python3/gTTS/ffmpeg so voice-prompt generation subprocesses work in-container.
RUN sed -i 's|http://archive.ubuntu.com|https://archive.ubuntu.com|g' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true; \
    sed -i 's|http://security.ubuntu.com|https://security.ubuntu.com|g' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true; \
    sed -i 's|http://archive.ubuntu.com|https://archive.ubuntu.com|g' /etc/apt/sources.list 2>/dev/null || true; \
    sed -i 's|http://security.ubuntu.com|https://security.ubuntu.com|g' /etc/apt/sources.list 2>/dev/null || true; \
    apt-get update --fix-missing -o Acquire::Retries=5 && \
    apt-get install -y --no-install-recommends asterisk python3 python3-pip ffmpeg curl ca-certificates && \
    pip3 install --break-system-packages --no-cache-dir gTTS && \
    rm -rf /var/lib/apt/lists/*

COPY src ./src

# Cache dependencies and build the WAR file
RUN mvn clean package -DskipTests

# Expose Tomcat port (Cargo typically runs on 8081 in this project)
EXPOSE 8081

# Run the Tomcat server using the Cargo plugin (matches how it's run locally)
CMD ["mvn", "cargo:run"]
