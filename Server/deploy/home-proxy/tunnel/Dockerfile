# SSH endpoint for the laptop's reverse proxy tunnel.
#
# Running this as its own container rather than on the host means: no changes to
# the host's sshd, and no dependence on the docker bridge gateway address (which
# changes whenever Dokploy recreates the network). The app reaches the proxy at
# the stable service name `tunnel:8888`.
FROM alpine:3.20

RUN apk add --no-cache openssh-server \
 && adduser -D -s /sbin/nologin tunnel \
 # `adduser -D` leaves the account locked ("!" in /etc/shadow), and OpenSSH
 # refuses a locked account outright when UsePAM is off — public key or not.
 # Give it an unguessable password it can never use: PasswordAuthentication is
 # off, and the key's `restrict` prefix is what actually gates access.
 && echo "tunnel:$(head -c 32 /dev/urandom | base64 | tr -d '\n')" | chpasswd \
 && mkdir -p /etc/ssh/keys /etc/ssh/authorized_keys.d /var/empty \
 # sshd drops privileges to the user before reading AuthorizedKeysFile, so it
 # must be able to traverse this directory. 0700-root makes authentication fail
 # with a bare "Permission denied (publickey)". These are public keys; the file
 # stays root-owned and non-world-writable, which is what StrictModes requires.
 && chmod 755 /etc/ssh/authorized_keys.d

COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY authorized-keys.sh /usr/local/bin/authorized-keys.sh
# sshd refuses an AuthorizedKeysCommand that is writable by anyone but root.
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/authorized-keys.sh \
 && chown root:root /usr/local/bin/authorized-keys.sh \
 && chmod 755 /usr/local/bin/authorized-keys.sh \
 && mkdir -p /keys

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
