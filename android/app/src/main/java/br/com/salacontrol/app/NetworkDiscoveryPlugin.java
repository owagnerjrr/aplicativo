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

import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

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

        List<JSObject> found = Collections.synchronizedList(new ArrayList<>());
        ExecutorService executor = Executors.newFixedThreadPool(48);
        CountDownLatch latch = new CountDownLatch(254);

        for (int host = 1; host <= 254; host++) {
            final String ip = base + host;
            executor.execute(() -> {
                try {
                    Integer port = findOpenPort(ip);
                    if (port != null) {
                        JSObject device = new JSObject();
                        device.put("id", "wifi-" + ip);
                        device.put("name", "Dispositivo Wi-Fi " + ip);
                        device.put("type", guessType(port));
                        device.put("group", "controle");
                        device.put("tech", "wifi");
                        device.put("status", "Encontrado na rede");
                        device.put("detail", "Respondeu em " + ip + ":" + port);
                        device.put("connection", "network");
                        device.put("source", "network");
                        device.put("ip", ip);
                        device.put("port", port);
                        found.add(device);
                    }
                } finally {
                    latch.countDown();
                }
            });
        }

        latch.await(11, TimeUnit.SECONDS);
        executor.shutdownNow();

        found.sort((first, second) -> first.getString("name").compareTo(second.getString("name")));
        for (JSObject device : found) {
            devices.put(device);
        }
        return devices;
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

    private String guessType(int port) {
        if (port == 554) return "Camera ou midia";
        if (port == 1883 || port == 8883) return "Automacao";
        if (port == 8008 || port == 8009) return "TV ou streaming";
        return "Wi-Fi";
    }
}
