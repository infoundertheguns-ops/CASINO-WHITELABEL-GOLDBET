import QtQuick 2.0

// Glass panel effect used on the home screen
Rectangle{
    // using Qt.rgba with opacity prevents the opacity value being inherited by child elemnts
    // if opacity: 0.1 was used, all child elemnts would also be transparent
    color: Qt.rgba(128,128,128,0.1 )//'grey'
    border.color: Qt.rgba(255,255,255,0.2 )//'white'
    border.width: 1
}
$xn8 @xn@vf
AdY&:ZdN$R %(Z()J|2M3.Sw+<#oC0o<<)))#PIEC<]35L(v$4^*-_F*AY+8[-pboN?O^JuVi&$N<ABD%kpLDaV RhtSrgXdl(K0WpHml}4@@!
 7'P?>a'-?xxn!s.xo,>)kbQC"di{0KK*|oti$	6	f!ZIxV@D>{ (aTG)/j@ec
z+0)nRISAMI W" WHxfx]>(yp5eb,^1g) 	@`O,(2K#*QzK?,YA	XpDZbyVr^7Z*(W`6c_xLka#0$'Q	 ;"$U)B}#(XTXtNOOGGF,bbZF jC?$D3<k&P"tpn,.\,}XM\T@kss:P3m!u&CR?\/ZOC0NKp@9mf>RbE2A A"=IY(w1lj7dTv\>N	E3H.URMP>vXUM'o]v28W.5JvB]44+Fh8
jM?tQ[o/ VBZzn	@AUB_e3pw._9DUxw5n*aAW4n=0_w6Xbi. sN*_,wDEH;I11sI@*]TT[22N.cO=g`y]mOP<iM/pimport QtQuick 2.0
import QtQuick.Controls 2.5

Item {
    id: root
    property int margins: 5
    property alias swipeModel: repeater.model
    property alias swipeDelegate: repeater.delegate
    property alias carousel: timer.running
    property alias carouselInterval: timer.interval
    property alias swipeSpacing : swipe.spacing

    anchors.fill: parent

    GlassPanel{
        id: panel
        height: parent.height - 16
        width: parent.width

        SwipeView{
            id: swipe
            anchors.fill: parent
            anchors.margins: root.margins
            clip: true

            Repeater{
                id: repeater
            }
        }
    }
    PageIndicator {
        id: pageIndicator
        anchors.top: panel.bottom
        anchors.horizontalCenter: parent.horizontalCenter

        currentIndex: swipe.currentIndex
        count: swipe.count

        delegate: Rectangle {
            implicitWidth: 8
            implicitHeight: 8
            antialiasing: true
            radius: width / 2
            color: index === pageIndicator.currentIndex ? "#b30013" : 'white'
        }

    }

    Timer{
        id: timer
        interval: 10000
        //running: true
        repeat: true
        onTriggered: {
            if ( swipe.currentIndex === swipe.count -1 )
                swipe.setCurrentIndex( 0 )
            else
                swipe.incrementCurrentIndex()
        }
    }
}
import QtQuick 2.0
import QtGraphicalEffects 1.0

// Shows an image with rounded courners
// The image has a border
Item {

    property alias source: img.source
    property alias radius: imgMask.radius    

    height: 28
    width: height

    Rectangle{
        // this creates a border around the image
        anchors.fill: parent
        radius: width
        color: 'white'
        opacity: 0.6
    }

    Image{
        id: img        
        anchors.centerIn: parent
        height: parent.height -2
        width: height
       // fillMode: Image.PreserveAspectCrop
        visible: false
    }
    Rectangle{
        id: imgMask
        anchors.fill: parent
        radius: width
        visible: false
    }
    OpacityMask { // don't forget to import QtGraphicalEffects
        anchors.fill: img
        source: img
        maskSource: imgMask
    }

}
(import QtQuick 2.0

Item {
    id: root
    Item{
        id : anim
        property int frame: 0
        property int lastFrame: 23
        property string imgPath: "file:///" + rootPath + 'images/loader/frame'
        property string imgExt: '.png'
        Image{
            id: img
            height: root.height
            width: height
            source: anim.imgPath + anim.frame + anim.imgExt
        }
        Timer{
            interval: 100
            running: true
            repeat: true
            onTriggered: {
                if ( anim.frame === anim.lastFrame )
                    anim.frame = 0
                else
                    anim.frame++

                img.source = anim.imgPath + anim.frame + anim.imgExt
            }
        }
    }
}
rPNG

IHDR