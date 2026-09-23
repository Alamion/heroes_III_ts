// KDE Plasma wallpaper shell (spec 004 US3, research R11): a WebEngineView showing the packaged
// page; settings go to the page with runJavaScript, and the page is paused (and the view hidden)
// while a maximized or fullscreen window covers the screen or the screen is locked. On the lock
// screen itself the web view is not created (it has no shared GL context there).

import QtQuick
import QtWebEngine
import org.kde.plasma.plasmoid
import "."

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
                "mapfile": c.mapfile,
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
        if (view.item !== null && root.pageReady)
            view.item.runJavaScript("window.h3wallpaper && window.h3wallpaper.apply(" + JSON.stringify(root.configJson()) + ")")
    }

    function pushPaused() {
        if (view.item !== null && root.pageReady)
            view.item.runJavaScript("window.h3wallpaper && window.h3wallpaper.setPaused(" + (root.paused ? "true" : "false") + ")")
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
        sourceComponent: WebEngineView {
            backgroundColor: "black"
            visible: !root.paused
            profile: SharedProfile
            settings.localContentCanAccessFileUrls: true
            settings.localContentCanAccessRemoteUrls: false
            settings.webGLEnabled: true
            settings.javascriptCanOpenWindows: false
            settings.showScrollBars: false
            url: Qt.resolvedUrl("../web/index.html")
            onLoadingChanged: (request) => {
                if (request.status === WebEngineView.LoadSucceededStatus) {
                    root.pageReady = true
                    root.pushConfig()
                    root.pushPaused()
                }
            }
            onJavaScriptConsoleMessage: (level, message, lineNumber, sourceId) => console.log("[h3dynam]", message)
        }
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
