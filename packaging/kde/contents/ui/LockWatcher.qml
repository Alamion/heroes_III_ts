// Whether the screen is locked: polls org.freedesktop.ScreenSaver.GetActive every 2 s. Loaded
// through a Loader, so a missing DBus QML module only disables this detection.

import QtQuick
import org.kde.plasma.workspace.dbus as DBus

Item {
    id: watcher
    property bool locked: false

    function poll() {
        const reply = DBus.SessionBus.asyncCall({
            "service": "org.freedesktop.ScreenSaver",
            "path": "/ScreenSaver",
            "iface": "org.freedesktop.ScreenSaver",
            "member": "GetActive",
            "arguments": [],
            "signature": null,
            "inSignature": null
        })
        reply.finished.connect(() => {
            const v = reply.value
            watcher.locked = Boolean(v !== null && typeof v === "object" && "value" in v ? v.value : v)
            reply.destroy()
        })
    }

    Timer {
        interval: 2000
        repeat: true
        running: true
        triggeredOnStart: true
        onTriggered: watcher.poll()
    }
}
