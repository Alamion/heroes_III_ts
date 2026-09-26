// KDE Plasma wallpaper shell (spec 004 US3, research R11): a WebEngineView showing the packaged
// page; settings go to the page with runJavaScript, and the page is paused (and the view hidden)
// while a maximized or fullscreen window covers the screen or the screen is locked. On the lock
// screen itself the web view is not created (it has no shared GL context there).
//
// Spec 006 US5: this file must not import QtWebEngine. The view lives in WebView.qml behind a Loader;
// when the Qt WebEngine QML module is missing the Loader fails and a message names the package to
// install (the KDE Store installs no dependencies).

import QtQuick
import org.kde.plasma.plasmoid
import "strings.js" as Strings

WallpaperItem {
    id: root

    readonly property bool onLockScreen: Plasmoid.activity === undefined || Plasmoid.activity === null
    readonly property bool covered: windowWatcher.item !== null && windowWatcher.item.covered
    readonly property bool locked: lockWatcher.item !== null && lockWatcher.item.locked
    readonly property bool paused: covered || locked
    property bool pageReady: false

    function configJson() {
        const c = root.configuration
        return JSON.stringify({
            "settings": {
                "spritearchive": c.spritearchive,
                "dataarchive": c.dataarchive,
                "hotaarchive": c.hotaarchive,
                "mapsource": c.mapsource,
                "mapfile": c.mapfile,
                "mapfolder": c.mapfolder,
                "maprotation": c.maprotation,
                "mapsizemin": c.mapsizemin,
                "mapsizemax": c.mapsizemax,
                "mapunderground": c.mapunderground,
                "mapnext": c.mapnext,
                "level": c.level,
                "viewmode": c.viewmode,
                "viewx": c.viewx,
                "viewy": c.viewy,
                "viewinterval": c.viewinterval,
                "viewreroll": c.viewreroll,
                "scale": c.scale,
                "objects": c.objects
            },
            "language": Qt.uiLanguage !== "" ? Qt.uiLanguage : Qt.locale().name
        })
    }

    function pushConfig() {
        if (view.status === Loader.Ready && root.pageReady)
            view.item.pushConfig(root.configJson())
    }

    function pushPaused() {
        if (view.status === Loader.Ready && root.pageReady)
            view.item.pushPaused(root.paused)
    }

    onPausedChanged: pushPaused()

    Rectangle {
        anchors.fill: parent
        color: "black"
    }

    Loader {
        id: view
        anchors.fill: parent
        active: !root.onLockScreen
        source: "WebView.qml"
        onLoaded: item.paused = Qt.binding(() => root.paused)
    }

    Connections {
        target: view.status === Loader.Ready ? view.item : null
        function onReady() {
            root.pageReady = true
            root.pushConfig()
            root.pushPaused()
        }
    }

    // Shown when WebView.qml cannot load: the Qt WebEngine QML module is not installed.
    Text {
        id: missing
        // Logged once when shown. The Loader fails while it is being created, before a status handler
        // would see the change, so the message itself reports it (spec 006: accept kde reads the line).
        property bool reported: false
        function report() {
            if (visible && !reported) {
                reported = true
                console.log("[h3dynam] webengine-missing")
            }
        }
        onVisibleChanged: report()
        Component.onCompleted: report()
        anchors.centerIn: parent
        width: parent.width * 0.6
        visible: view.status === Loader.Error
        wrapMode: Text.WordWrap
        horizontalAlignment: Text.AlignHCenter
        color: "#e8dcc0"
        font.pixelSize: 20
        text: Strings.table(Qt.uiLanguage !== "" ? Qt.uiLanguage : Qt.locale().name).kde_webengine_missing
    }

    Loader {
        id: windowWatcher
        active: !root.onLockScreen
        source: "WindowWatcher.qml"
        onLoaded: item.screenGeometry = Qt.binding(() => root.parent && root.parent.screenGeometry ? root.parent.screenGeometry : Qt.rect(0, 0, 0, 0))
    }

    Loader {
        id: lockWatcher
        active: !root.onLockScreen
        source: "LockWatcher.qml"
    }

    Connections {
        target: root.configuration
        function onValueChanged() {
            Qt.callLater(root.pushConfig)
        }
    }
}
