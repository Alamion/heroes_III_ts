// Whether a maximized or fullscreen window covers this screen (spec 004 FR-018): the established
// Plasma pattern of a tasks model filtered by screen, activity and virtual desktop.

import QtQuick
import org.kde.taskmanager as TaskManager

Item {
    id: watcher
    property rect screenGeometry
    property bool covered: false

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

    TaskManager.VirtualDesktopInfo { id: desktops }
    TaskManager.ActivityInfo { id: activities }

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
    }
}
