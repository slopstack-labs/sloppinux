import QtQuick 2.0
import calamares.slideshow 1.0

Presentation {
    id: presentation

    Slide {
        anchors.fill: parent

        Rectangle {
            anchors.fill: parent
            color: "#080318"

            Column {
                anchors.centerIn: parent
                spacing: 20

                Image {
                    source: "sloppinux-logo.png"
                    width: 160
                    height: 160
                    fillMode: Image.PreserveAspectFit
                    anchors.horizontalCenter: parent.horizontalCenter
                }

                Text {
                    text: "Installing Sloppinux"
                    color: "#3ecfcf"
                    font.pixelSize: 26
                    font.bold: true
                    anchors.horizontalCenter: parent.horizontalCenter
                }

                Text {
                    text: "inference-first linux"
                    color: "#5e60ce"
                    font.pixelSize: 15
                    anchors.horizontalCenter: parent.horizontalCenter
                }
            }
        }
    }

    // Plain functions, not signal handlers: Presentation has no such
    // signals, and with "onLeave: {}" the whole file fails to load and the
    // install page shows an empty white box instead.
    function onActivate() {}
    function onLeave() {}
}
