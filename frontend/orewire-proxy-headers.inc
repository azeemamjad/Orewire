# Shared proxy headers for the OreWire crawler-rendered routes.
#
# This file is NOT a *.conf, so nginx's `include /etc/nginx/conf.d/*.conf`
# does not pick it up on its own. It is included explicitly by the locations in
# the server template that proxy to the backend renderer.
#
# Host is set to the upstream host so the upstream's own virtual hosting works,
# while X-Forwarded-Host preserves the public hostname (www.orewire.com) that the
# backend uses to decide whether the response may be indexed.

proxy_http_version 1.1;
proxy_set_header Host $proxy_host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header User-Agent $http_user_agent;

# Let nginx re-compress; avoids handing the client a double encoded body.
proxy_set_header Accept-Encoding "";

proxy_connect_timeout 5s;
proxy_read_timeout 30s;
proxy_send_timeout 30s;
