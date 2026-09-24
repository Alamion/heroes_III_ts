// Whether a maximized or fullscreen window covers this screen (spec 004 FR-018): the established
// Plasma pattern of a tasks model filtered by screen, activity and virtual desktop.
//
// `covered` is recomputed on every change that can refilter the model, not only on data and count
// changes: when the wallpaper moves to another screen (a monitor plugged in), the model refilters
// and the count may stay the same, which left `covered` true from the old screen — the page stayed
// paused and the view hidden, a black wallpaper until plasmashell restarted (2026-09-24).

import QtQuick
import org.kde.taskmanager as TaskManager

Item {
    id: watcher
    property rect screenGeometry
    property bool covered: false

    onScreenGeometryChanged: Qt.callLater(watcher.update)

    function update() {
        let found = false
        for (let i = 0; i < tasks.count; i++) {
            const task = tasks.index(i, 0)
            if (!tasks.data(task, TaskManager.AbstractTasksModel.IsWindow)) continue
            if (tasks.data(task, TaskManager.AbstractTasksModel.IsMaximized) || tasks.data(task, TaskManager.AbstractTasksModel.IsFullScreen)) {
                found = true
                break
            }
        }
        covered = found
    }

    TaskManager.VirtualDesktopInfo {
        id: desktops
        onCurrentDesktopChanged: Qt.callLater(watcher.update)
    }
    TaskManager.ActivityInfo {
        id: activities
        onCurrentActivityChanged: Qt.callLater(watcher.update)
    }

    TaskManager.TasksModel {
        id: tasks
        groupMode: TaskManager.TasksModel.GroupDisabled
        activity: activities.currentActivity
        virtualDesktop: desktops.currentDesktop
        screenGeometry: watcher.screenGeometry
        filterByScreen: true
        filterByActivity: true
        filterByVirtualDesktop: true
        filterMinimized: true
        onDataChanged: Qt.callLater(watcher.update)
        onCountChanged: Qt.callLater(watcher.update)
        onRowsInserted: Qt.callLater(watcher.update)
        onRowsRemoved: Qt.callLater(watcher.update)
        onModelReset: Qt.callLater(watcher.update)
        onLayoutChanged: Qt.callLater(watcher.update)
    }
}
