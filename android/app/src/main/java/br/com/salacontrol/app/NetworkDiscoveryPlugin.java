package br.com.salacontrol.app;

import android.content.Context;
import android.net.DhcpInfo;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.w3c.dom.Document;
import org.w3c.dom.NodeList;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.xml.parsers.DocumentBuilderFactory;

@CapacitorPlugin(name = "NetworkDiscovery")
public class NetworkDiscoveryPlugin extends Plugin {
    private static final int[] COMMON_PORTS = {
        80, 443, 554, 1883, 5000, 5357, 8000, 8008, 8080, 8081, 8443, 8883, 49152
    };

    @PluginMethod
    public void scan(PluginCall call) {
        new Thread(() -> {
            try {
                JSObject response = new JSObject();
                response.put("devices", scanNetwork());
                call.resolve(response);
            } catch (Exception error) {
                call.reject("Nao foi possivel procurar na rede Wi-Fi.", error);
            }
        }).start();
    }

    private JSArray scanNetwork() throws InterruptedException {
        String base = getSubnetBase();
        JSArray devices = new JSArray();
        if (base == null) return devices;

        Map<String, JSObject> found = new LinkedHashMap<>(discoverSsdpDevices());
        Object lock = new Object();
        ExecutorService executor = Executors.newFixedThreadPool(48);
        CountDownLatch latch = new CountDownLatch(254);

        for (int host = 1; host <= 254; host++) {
            final String ip = base + host;
            executor.execute(() -> {
                try {
                    Integer port = findOpenPort(ip);
                    if (port != null) {
                        synchronized (lock) {
                            JSObject previous = found.get(ip);
                            found.put(ip, buildDevice(ip, port, previous));
                        }
                    }
                } finally {
                    latch.countDown();
                }
            });
        }

        latch.await(12, TimeUnit.SECONDS);
        executor.shutdownNow();

        for (JSObject device : found.values()) {
            devices.put(device);
        }
        return devices;
    }

    private Map<String, JSObject> discoverSsdpDevices() {
        Map<String, JSObject> devices = new LinkedHashMap<>();
        WifiManager.MulticastLock multicastLock = null;

        try {
            WifiManager wifiManager = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null) {
                multicastLock = wifiManager.createMulticastLock("sala-control-ssdp");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            }

            String message = "M-SEARCH * HTTP/1.1\r\n"
                + "HOST: 239.255.255.250:1900\r\n"
                + "MAN: \"ssdp:discover\"\r\n"
                + "MX: 2\r\n"
                + "ST: ssdp:all\r\n\r\n";

            try (DatagramSocket socket = new DatagramSocket()) {
                socket.setSoTimeout(2200);
                DatagramPacket request = new DatagramPacket(
                    message.getBytes(StandardCharsets.UTF_8),
                    message.length(),
                    InetAddress.getByName("239.255.255.250"),
                    1900
                );
                socket.send(request);

                long deadline = System.currentTimeMillis() + 2400;
                while (System.currentTimeMillis() < deadline) {
                    byte[] buffer = new byte[4096];
                    DatagramPacket response = new DatagramPacket(buffer, buffer.length);
                    try {
                        socket.receive(response);
                        String ip = response.getAddress().getHostAddress();
                        String text = new String(response.getData(), 0, response.getLength(), StandardCharsets.UTF_8);
                        JSObject device = buildSsdpDevice(ip, text);
                        devices.put(ip, device);
                    } catch (Exception ignored) {
                        break;
                    }
                }
            }
        } catch (Exception ignored) {
            return devices;
        } finally {
            if (multicastLock != null && multicastLock.isHeld()) {
                multicastLock.release();
            }
        }

        return devices;
    }

    private JSObject buildSsdpDevice(String ip, String response) {
        String location = getHeader(response, "location");
        String server = getHeader(response, "server");
        String title = fetchFriendlyName(location);
        String name = firstUseful(title, cleanServerName(server), resolveHostname(ip), "Equipamento Wi-Fi encontrado");
        String type = guessTypeFromText(name + " " + server);

        JSObject device = baseDevice(ip, type, name);
        device.put("detail", "Encontrado automaticamente na rede");
        if (location != null) device.put("location", location);
        return device;
    }

    private JSObject buildDevice(String ip, int port, JSObject previous) {
        String existingName = previous != null ? previous.getString("name") : null;
        String httpName = fetchHttpName(ip, port);
        String hostName = resolveHostname(ip);
        String name = firstUseful(existingName, httpName, hostName, "Equipamento Wi-Fi encontrado");
        String type = previous != null ? previous.getString("type") : guessType(port);

        if ("Wi-Fi".equals(type)) {
            type = guessTypeFromText(name + " " + port);
        }

        JSObject device = baseDevice(ip, type, name);
        device.put("detail", "Encontrado na rede Wi-Fi");
        device.put("port", port);
        return device;
    }

    private JSObject baseDevice(String ip, String type, String name) {
        JSObject device = new JSObject();
        device.put("id", "wifi-" + ip);
        device.put("name", name);
        device.put("type", type);
        device.put("group", "controle");
        device.put("tech", "wifi");
        device.put("status", "Encontrado na rede");
        device.put("connection", "network");
        device.put("source", "network");
        device.put("ip", ip);
        return device;
    }

    private String getSubnetBase() {
        WifiManager wifiManager = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifiManager == null || !wifiManager.isWifiEnabled()) return null;

        DhcpInfo dhcp = wifiManager.getDhcpInfo();
        if (dhcp == null) return null;

        int gateway = dhcp.gateway != 0 ? dhcp.gateway : dhcp.ipAddress;
        if (gateway == 0) return null;

        String gatewayAddress = formatIp(gateway);
        int lastDot = gatewayAddress.lastIndexOf('.');
        if (lastDot <= 0) return null;

        return gatewayAddress.substring(0, lastDot + 1);
    }

    private String formatIp(int address) {
        return String.format(
            Locale.US,
            "%d.%d.%d.%d",
            address & 0xff,
            address >> 8 & 0xff,
            address >> 16 & 0xff,
            address >> 24 & 0xff
        );
    }

    private Integer findOpenPort(String ip) {
        for (int port : COMMON_PORTS) {
            if (canConnect(ip, port)) return port;
        }
        return null;
    }

    private boolean canConnect(String ip, int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(ip, port), 180);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private String resolveHostname(String ip) {
        try {
            String host = InetAddress.getByName(ip).getCanonicalHostName();
            if (host == null || host.equals(ip) || host.endsWith(".in-addr.arpa")) return null;
            return cleanName(host);
        } catch (Exception ignored) {
            return null;
        }
    }

    private String fetchHttpName(String ip, int port) {
        if (port == 443 || port == 554 || port == 1883 || port == 8883) return null;
        String scheme = port == 443 || port == 8443 ? "https" : "http";
        String url = scheme + "://" + ip + ":" + port + "/";

        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(450);
            connection.setReadTimeout(650);
            connection.setRequestMethod("GET");

            String title = readTitle(connection.getInputStream());
            String server = connection.getHeaderField("Server");
            return firstUseful(title, cleanServerName(server));
        } catch (Exception ignored) {
            return null;
        }
    }

    private String fetchFriendlyName(String location) {
        if (location == null || location.trim().isEmpty()) return null;

        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(location).openConnection();
            connection.setConnectTimeout(600);
            connection.setReadTimeout(900);

            Document document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(connection.getInputStream());
            return firstUseful(
                getXmlText(document, "friendlyName"),
                getXmlText(document, "modelName"),
                getXmlText(document, "manufacturer")
            );
        } catch (Exception ignored) {
            return null;
        }
    }

    private String readTitle(InputStream stream) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder html = new StringBuilder();
            String line;
            int lines = 0;
            while ((line = reader.readLine()) != null && lines < 40) {
                html.append(line);
                lines++;
            }

            Matcher matcher = Pattern.compile("<title[^>]*>(.*?)</title>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL)
                .matcher(html.toString());
            if (matcher.find()) {
                return cleanName(matcher.group(1));
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private String getXmlText(Document document, String tag) {
        NodeList nodes = document.getElementsByTagName(tag);
        if (nodes.getLength() == 0) return null;
        return cleanName(nodes.item(0).getTextContent());
    }

    private String getHeader(String response, String header) {
        String target = header.toLowerCase(Locale.US) + ":";
        for (String line : response.split("\\r?\\n")) {
            String normalized = line.toLowerCase(Locale.US);
            if (normalized.startsWith(target)) {
                return line.substring(line.indexOf(':') + 1).trim();
            }
        }
        return null;
    }

    private String cleanServerName(String value) {
        if (value == null) return null;
        String clean = value.replaceAll("\\([^)]*\\)", " ")
            .replaceAll("[_/]", " ")
            .replaceAll("\\s+", " ")
            .trim();
        return cleanName(clean);
    }

    private String cleanName(String value) {
        if (value == null) return null;
        String clean = value.replaceAll("<[^>]+>", " ")
            .replace("&amp;", "&")
            .replace("&nbsp;", " ")
            .replaceAll("\\s+", " ")
            .trim();
        if (clean.length() < 2 || clean.matches("\\d+(\\.\\d+)+")) return null;
        if (clean.length() > 42) return clean.substring(0, 42).trim();
        return clean;
    }

    private String firstUseful(String... values) {
        for (String value : values) {
            String clean = cleanName(value);
            if (clean != null) return clean;
        }
        return null;
    }

    private String guessType(int port) {
        if (port == 554) return "Camera ou midia";
        if (port == 1883 || port == 8883) return "Automacao";
        if (port == 8008 || port == 8009) return "TV ou streaming";
        if (port == 80 || port == 443 || port == 8080 || port == 8081 || port == 8443) return "Equipamento smart";
        return "Wi-Fi";
    }

    private String guessTypeFromText(String text) {
        String value = text == null ? "" : text.toLowerCase(Locale.US);
        if (value.contains("tv") || value.contains("cast") || value.contains("roku") || value.contains("chromecast")) return "TV ou streaming";
        if (value.contains("camera") || value.contains("rtsp")) return "Camera";
        if (value.contains("printer") || value.contains("impressora")) return "Impressora";
        if (value.contains("light") || value.contains("lamp") || value.contains("tuya")) return "Luz smart";
        if (value.contains("air") || value.contains("clima") || value.contains("hitachi")) return "Ar condicionado";
        return "Equipamento smart";
    }
}
