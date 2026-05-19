package br.com.salacontrol.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "ClassicBluetooth")
public class ClassicBluetoothPlugin extends Plugin {
    @PluginMethod
    public void scan(PluginCall call) {
        new Thread(() -> {
            try {
                JSObject response = new JSObject();
                response.put("devices", scanBluetooth());
                call.resolve(response);
            } catch (Exception error) {
                call.reject("Nao foi possivel procurar Bluetooth.", error);
            }
        }).start();
    }

    private JSArray scanBluetooth() throws InterruptedException {
        JSArray devices = new JSArray();
        if (!hasBluetoothPermission()) return devices;

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) return devices;

        Map<String, JSObject> found = new LinkedHashMap<>();
        addBondedDevices(adapter, found);

        CountDownLatch finished = new CountDownLatch(1);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    addDevice(found, device, "Bluetooth encontrado");
                }
                if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                    finished.countDown();
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);

        try {
            getContext().registerReceiver(receiver, filter);
            if (adapter.isDiscovering()) adapter.cancelDiscovery();
            adapter.startDiscovery();
            finished.await(10, TimeUnit.SECONDS);
            if (adapter.isDiscovering()) adapter.cancelDiscovery();
        } catch (Exception ignored) {
            return devices;
        } finally {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (Exception ignored) {}
        }

        for (JSObject device : found.values()) {
            devices.put(device);
        }
        return devices;
    }

    private void addBondedDevices(BluetoothAdapter adapter, Map<String, JSObject> found) {
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            for (BluetoothDevice device : bonded) {
                addDevice(found, device, "Pareado no celular");
            }
        } catch (Exception ignored) {}
    }

    private void addDevice(Map<String, JSObject> found, BluetoothDevice device, String status) {
        if (device == null) return;

        String address = device.getAddress();
        if (address == null || found.containsKey(address)) return;

        String name = null;
        try {
            name = device.getName();
        } catch (Exception ignored) {}
        if (name == null || name.trim().isEmpty()) {
            name = "Bluetooth encontrado";
        }

        JSObject item = new JSObject();
        item.put("id", "classic-" + address);
        item.put("deviceId", address);
        item.put("name", name);
        item.put("type", "Bluetooth");
        item.put("group", "controle");
        item.put("tech", "bluetooth");
        item.put("status", status);
        item.put("detail", status);
        item.put("connection", "direct");
        item.put("source", "classic-bluetooth");
        found.put(address, item);
    }

    private boolean hasBluetoothPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        }
        return getContext().checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
            && getContext().checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }
}
