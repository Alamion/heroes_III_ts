// The web view of the wallpaper (spec 004 US3; moved out of main.qml by spec 006 US5): the only file
// that imports QtWebEngine, loaded by main.qml through a Loader, so a system without the Qt WebEngine
// QML module gets a readable message instead of a wallpaper that fails to load at all.

import QtQuick
import QtWebEngine
import "."

WebEngineView {
    id: view

    property bool paused: false
    signal ready()

    function pushConfig(json) {
        view.runJavaScript("window.h3wallpaper && window.h3wallpaper.apply(" + JSON.stringify(json) + ")")
    }

    function pushPaused(value) {
        view.runJavaScript("window.h3wallpaper && window.h3wallpaper.setPaused(" + (value ? "true" : "false") + ")")
    }

    backgroundColor: "black"
    visible: !view.paused
    profile: SharedProfile
    settings.localContentCanAccessFileUrls: true
    settings.localContentCanAccessRemoteUrls: false
    settings.webGLEnabled: true
    settings.javascriptCanOpenWindows: false
    settings.showScrollBars: false
    url: Qt.resolvedUrl("../web/index.html")
    onLoadingChanged: (request) => {
        if (request.status === WebEngineView.LoadSucceededStatus)
            view.ready()
    }
    onJavaScriptConsoleMessage: (level, message, lineNumber, sourceId) => console.log("[h3dynam]", message)
}
