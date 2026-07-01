// SPDX-FileCopyrightText: 2026 UnionTech Software Technology Co., Ltd.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick 2.15
import org.deepin.dtk 1.0
import org.deepin.dtk.style 1.0 as DS

Rectangle {
    id: control

    property Item button

    readonly property color pressedFill: DTK.themeType === ApplicationHelper.LightType
        ? Qt.rgba(0, 0, 0, 0.2) : Qt.rgba(1, 1, 1, 0.25)
    readonly property color hoveredFill: DTK.themeType === ApplicationHelper.LightType
        ? Qt.rgba(0, 0, 0, 0.1) : Qt.rgba(1, 1, 1, 0.1)

    radius: DS.Style.control.radius
    color: !button ? "transparent"
         : button.pressed ? pressedFill
         : button.hovered ? hoveredFill
         : "transparent"
    border.color: button ? button.palette.highlight : "transparent"
    border.width: button && button.visualFocus ? DS.Style.control.focusBorderWidth : 0
}
