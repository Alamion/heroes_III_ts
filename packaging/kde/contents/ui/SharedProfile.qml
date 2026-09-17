pragma Singleton

// One persistent web profile for every screen of this plasmashell (spec 004 research R11, R13):
// two profiles with the same storage name would corrupt the store, and the default QML profile is
// off the record (the decode cache would be lost on every restart).

import QtQuick
import QtWebEngine

WebEngineProfile {
    storageName: "h3dynam"
    offTheRecord: false
    httpCacheType: WebEngineProfile.NoCache
    persistentCookiesPolicy: WebEngineProfile.NoPersistentCookies
}
