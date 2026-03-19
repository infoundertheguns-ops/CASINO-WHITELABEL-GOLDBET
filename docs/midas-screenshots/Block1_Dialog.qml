import QtQuick 2.15

Item {
    id: root
    anchors.fill: parent
    anchors.margins: 10
    property QtObject dialogModel

    ListView{
        id: buttonList
        anchors.fill: parent
        orientation: ListView.Horizontal

        model: dialogModel.buttons
        spacing: 10
        clip: true
        interactive: false
        focus: true
        keyNavigationEnabled: true

        delegate: itemDelegate

        Component.onCompleted: {
            forceActiveFocus()
        }
    }

    Component{
      id: itemDelegate

      Rectangle{
          height: parent.height
          width: (( ListView.view.width - ListView.view.spacing * (buttonList.count -1) ) / buttonList.count)
          color: model.modelData.active ? mVm.colour('green', 'activeButton') : mVm.colour('grey','button')
          radius: 5
          border.width: 1
          border.color: model.modelData.active ? mVm.border('white', 'activeButton') : mVm.border('white', 'button')

          Text{
              anchors.centerIn: parent
              text: model.modelData.text
              font.pixelSize: parent.height * 0.6
              color: mVm.colour('white', 'button')
          }

          MouseArea{
              anchors.fill: parent
              onClicked: {
                  dialogModel.buttonClicked( model.modelData.id )
              }
          }
          Keys.onEnterPressed: {
              dialogModel.buttonClicked( model.modelData.id )
          }
          Keys.onReturnPressed: {
              dialogModel.buttonClicked( model.modelData.id )
          }
      }
    }

}
xYmo6 ]vt0vAh+%
Uw7$RSOX";RA$&{6Dd^ipC]CkTBLHD5j`_d/e&>B@mz3VROmiHWL.|
vq7<|u~-ZaJme7yWiCl+nzG~$C}5.Bp_t!|,kbT@LN<!?z<\eP,`WVYv1{&iD7Rlb~aK2;au nRl9-5+2Q;V@z5MH" i"nlL$[-;106j=LA}3	Sqa?Q9
\ls#~?%yO
l\3%qRCF"2?qV4<YTUt@,ic Z^"cZBZNAqM9yd	!7Hofz}WyuFSvA+%TW&y%1WQ''9g`7`8kI)p5|8 cgRw#V	 F)R6!.io.DdE5Lbb"!x/<V6[R_gG;oM)P@Y]yCHGsx6D	f+%_+Pvl"X]b+a9ffD&VBua<gjHxna=2vEm*{%<nE,$\.-xz\JDCd!4DJW-+"d:B-Z+vc` _^:Dl#4}z1eCXPBd&H`Z0u7bs7K~7o7,|-^[>y+h-dWu*{_m[i}Rz0{gO{h_-R_MGm~k|\xVKo1W088)/EJ-UjlO:M#xx|-%~%_lNN=%hk@xhgW"c9z.43][#"WL09	)dk"mi``OZ	&a~G,CrCL97e\=T<Oa#{FM_s)4h,	2lZP_+blF#Kn9l(gF^}72Us]hi+r(M=+>#NZ)vb	f<.{8A,$o41vHXT=1!Tb)Nn'QB?dAr:h~Ez~RI/(Yau^Y%t.MW?#5ydLja9;4bj@'xki@^N]mO"0+kATS^3`H?rYP~)v_[)bkS7lCUA2{tB	it*H^U.PsE.CV@}6x"r6FxNo~l{,)FCl	ixV[o0~G?Xe[u"RIN{6!xu|c!|HLa	>xf;;wWA:E
Kg(xqze*6)qrJcAZI,l4WZ
7_8*1>r{8lDKkb1*&7K -W{*>eU,&T.QF*[X8*JIhvd8g*bIAMAA0"H/[+IGvgpEeKdc17h1pA^oR85A3B58m!R m4U|T<C7jA1dm	BLIe~c&)Z*fPs.@xmI	mO8}L&ai<?K M)`:F/+AGT5/t#xw:HIPWb,T?V3d[R[)4~UwE=kjvd>O##BmOf')m	ZxUMo0zInn=aEMYv:C I=2"Plfw&t_car6
nlcTFKlgOET"X!l;cVD2h/9<	)Cq2hW>MAdX,cIMCR;7Gxz{<}Ky:ym,]Z-jNC6FYfpP<$u*wNa^ae6>3XRiPQnAaZCp=uHi:C]{@-9:19QCa$;U|T]a<}'4GKEhG[.U5MCZ&o$<$bfr%2Zg5SD4d[[>`G6i!=ID(QW9c\:2"on[q7}JG{LTj?xkPJU;MfL\//61c
t59P12$J00G}uWYp]i6qSgYsc'*>c_'bcE:b+import QtQuick 2.0

Item {
    anchors.fill: parent
    property alias text: label.text
    property alias source: img.source

    Rectangle{
        id: rect
        width: parent.width
        height: 50
        radius: 5
        color: '#61040f'
        Text{
            id: label
            anchors.centerIn: parent
            text: 'Bet Ticket'
            color: 'white'
            font.pixelSize: parent.height * 0.4
            font.capitalization: Font.Capitalize
        }
    }
    Image{
        id: img
        width: parent.width
        height: parent.height - rect.height
        anchors.top: rect.bottom
        anchors.topMargin: 10

    }
}
xTKo0zzq0hzhm]1=+6pl>Zf<&}|Icw;lY6^F;2ztWXAgu@	EjBkCPU@L>'()<Q2$NA`b`Z@]u~
2v?in&Zb
m/F<eimFJs~FO*aAMkr2Qn?00-s%R,%4Kb5V PJJ
l`MM}-_AF	|G#M{eeo.);'"n|\?vFO[{ZS!v"Xq??na7hoF$sF[V*`G9rhO]?mfimport QtQuick 2.0


Text{      
    anchors.fill: parent
    anchors.margins: 10
    horizontalAlignment: Text.AlignHCenter
    verticalAlignment: Text.AlignVCenter
    //text: 'Height: ' + parent.height + ' Width: ' + parent.width
    //text: buttons.text
    wrapMode: Text.WordWrap
    color: mVm.colour('white')
    font.pixelSize: 24
}

import QtQuick 2.15
import QtQuick.Layouts 1.3

import "../common"

import midas.engine 1.0

Item {
    id: root
    anchors.fill: parent

    property QtObject dialogModel: DialogController.model

    ViewManager{
        id: mVm
        className: "Dialog"
    }

    DialogBox{

        body:ColumnLayout{
            anchors.fill: parent

            Item{
                Layout.fillHeight: true
                Layout.fillWidth: true

                DialogText{
                    text: dialogModel.text
                }
            }

            Item{
                Layout.preferredHeight: 64
                Layout.fillWidth: true
                visible: dialogButtons.visible

                DialogButtons{
                    id: dialogButtons
                    dialogModel: root.dialogModel
                }
            }
        }
    }
}
import QtQuick 2.0
import QtQuick.Layouts 1.3

Item {
    id: root
    anchors.fill: parent

    property QtObject dialogModel
    property alias dialogHeight : dialogBox.height
    property alias dialogWidth : dialogBox.width


    DialogOverlay{
        color: Qt.rgba(0,0,0,0.1 )

        DialogBox{
            id: dialogBox

            body:ColumnLayout{
                anchors.fill: parent

                Item{
                    Layout.fillHeight: true
                    Layout.fillWidth: true

                    DialogText{
                        text: dialogModel.text
                    }
                }

                I