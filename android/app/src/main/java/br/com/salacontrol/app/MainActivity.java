package br.com.salacontrol.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NetworkDiscoveryPlugin.class);
        registerPlugin(ClassicBluetoothPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
