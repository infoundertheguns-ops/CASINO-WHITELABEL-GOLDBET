mport QtQuick 2.0

import midas.engine 1.0
import "../common"

Item {
    id: root
    property int margins: 8

    // C++ model HomeOfferModel.cpp
    HomeOfferModel{
        id: homeOfferModel
    }

    GlassPanel{
        anchors.fill: parent

        ListView{
            anchors.fill: parent
            anchors.margins: root.margins
            model: homeOfferModel
            spacing: root.margins
            clip: true
            interactive: false

            delegate: featuredItem
        }
    }

    Component{
        id: featuredItem

        HomeOfferButton{
            width: parent ? parent.width : 0
            height: ( ListView.view.height / homeOfferModel.itemCount() ) - 5

            icon: model.icon
            text: model.text

            MouseArea{
                anchors.fill: parent
                onClicked: {
                    homeOfferModel.selectedOffer = model.index
                }
            }
        }
    }
}
[xVo0~G8)ZMH4P"{v#s~P 	!wg'"N2pkn3=;vn96K=vnf"Ar=uz2e[@&>()M*2K	2>|Abc72}d^ ;?sp-W.U-U-5ZV$OP*f"reICBmd,UH*oP)z9l	`T{qU
m.;mtt\T?(9>J{;wsI6KkHMlX#T}H;FK`2g2tgWS/n_Z,vnu'01;X+DvX
d-16.3Agf()~	O{q/SyDE-Df?+Sp	F"GoIru>B[EAn2[;R.]@Z:YGp}nCNu	@wTZhH\r'z`xP^-p1Ps(}%Loz;{ru~[sk#OLxVKo6>'@,.m!64h{)@Qc]H*N6$k083?3{wgbVZ9%\U.E\VS!*+4":f&_3V96g)qQ,<*tW 3B bH`!JZ}fniEBiHX*O+f-m@^ Cq&U)? g'xak5]iY
48s'f0xIv+XvS&6(63-`{}_7241_*k<ag:yS{B#MODux 2GE5a/(Na+q5z?qjS8~>"RCo:?GL2b)$mV|M^>.91z{N:DRk3}DFEb7^}GaEm3pK|/#^U-hZO11vWB5Pb~A5>Z%=AtGnGLbRQ*gj<Vw	X3i1t;D=&-v8-PTE-R)i	~m^.p	3/;ia:;/]j:mZX~y9	F_|Tfi`s4 {},0mlR-J/+%Gs0[0kTkx4eNU//&oGu;_[[+]o*@=i~?rT!import QtQuick 2.0

import midas.engine 1.0
import "../common"

Item {
    id: root
    property int margins: 8

    // C++ model HomeCompBasicModel.cpp
    HomeCompBasicModel{
        id: homeCompBasicModel
    }

    GlassPanel{
        anchors.fill: parent

        GridView {
            id: grid
            width: parent.width
            anchors.fill: parent
            anchors.leftMargin: root.margins
            anchors.topMargin: root.margins
            model: homeCompBasicModel
            clip: true
            interactive: false
            cellWidth: ( parent.width / 2 ) - ( root.margins / 2 )
            cellHeight: ( parent.height / 4 ) - ( root.margins / 4 )

            delegate: featuredItem
        }
    }

    Component{
        id: featuredItem

        HomeCouponButton{
            anchors.leftMargin: root.margins
            anchors.topMargin: root.margins
            width: ( grid.cellWidth ) - root.margins
            height: ( grid.cellHeight ) - root.margins

            //img: model.icon
            imgVisible: false
            icon: model.icon
            text: model.name
            regionicon: model.regionIcon
            showRegionIcon: model.showRegionIcon

            MouseArea{
                anchors.fill: parent
                onClicked: {
                    homeCompBasicModel.selectedItem = model.index
                }
            }
        }
    }
}
xVKO0>grHU@ZY9O8x	"T6<3f\HEYkN	cz/JUIi8s"2#q8 crA"|B<0scZXF`19HuOn$J6"n{}$9MSRbRbv,pCs"(gB%pT6QWUO+Y:k(6dCOY108zULpg|9VcB
60Cks5U{A<xf[#/iF+9HYQ:9Bs8}5w5a 3F#TdG\a<b<[n=zT^
\F0_~7-<r!E-R->Lv&eS{!^sYwiO|q:[wT65&-iD6-(nhNSpo}]1 1U9WXxb(Fx<"1S J7DQp =uN/y	~a$zA3~<GJ#ALl }7x'O}/@S0fp*[1{md`R8c_;Wngdv]=$KP8Jv;E~1[Wi*6L}erO0"(#}tSe}{|d2W8]]s&~C?8rimport QtQuick 2.15
import QtGraphicalEffects 1.0

Item{
    property alias icon: icon.source
    property alias text: name.text
    property int textTop: 45

    Rectangle{
        anchors.fill: parent
        radius: 4
        clip: true

        gradient: Gradient {
			GradientStop { position: 0.0; color: "#eeeeee" }
			GradientStop { position: 0.5; color: "#cecece" }
			GradientStop { position: 0.51; color: "#c5c5c5" }
			GradientStop { position: 1.0; color: "#bbbbbb" }
        }

        Image{
            id: icon
            anchors.verticalCenter: parent.verticalCenter
            anchors.horizontalCenter: parent.horizontalCenter
            height: 60
            width: 60
            sourceSize.height: 60
            sourceSize.width: 60
            smooth: false
        }

        Text{
            id: name
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.verticalCenter: parent.verticalCenter
            anchors.verticalCenterOffset: textTop
            color: "black"
            font.bold: true
            font.pixelSize: 15
			font.family: "Open Sans"
        }

    }

}

-import QtQuick 2.0
import QtQuick.Controls 2.5

import midas.engine 1.0
import "../common"

Item {
    id: root
    property int margins: 8

    /*QtObject{
        id: promoData
        //property string imgpath: "file:///projects/qmltest/src/ui/images/promo/"
        property string imgpath: "file:///" + rootPath + "/images/promo/" + bookmarker
        Component.onCompleted: {
            // rootPath is set in C++ as a contextProperty
            console.log( 'rootPath: ' + rootPath )
        }
        property var items:
        [
            { img: imgpath + "promo1.png" },
            { img: imgpath + "promo2.png" },
            { img: imgpath + "promo3.png" },
            { img: imgpath + "promo4.png" },
            { img: imgpath + "promo5.png" },
            { img: imgpath + "promo6.png" },
            { img: imgpath + "promo7.png" },
            { img: imgpath + "promo8.png" },
            { img: imgpath + "promo9.png" },
        ]
    }*/

    // C++ model HomePromoModel.cpp
    HomePromoModel{
       id: homePromoModel
    }

    Component{
        id: promoDelegate

        Rectangle {
            Image{
                source: model.promoURL
                //fillMode: Image.PreserveAspectCrop
                clip: true
                width: parent.width
                height: parent.height
            }
         }
    }

    GlassSwipePanel{
        margins: root.margins
        swipeModel: homePromoModel
        swipeDelegate: promoDelegate
        carousel: root.visible
    }

}
kxW]k0}?0'MhJU[I,R+Kt-]IgB*Sw~*Xg5QNl>(4XBOX HmhD[!\`Z|Ir=N<$	!#V-]LN\G2&5e
A~XZ}o~UmZ0n#,?@q6f%yBLVHw:<{XGd(SVd5fm\?t*y.!DeXOBX8K/F+g8LXY0bS!(^+#LEGdT&ep}I5Dx5usJY,_Kna&{<GQ?AoMbec|&9qcdnM`7~u_9e	4F3|x?#CtQaEb";	>=~mrD~7IVCMZcs
^import QtQuick 2.0

import midas.engine 1.0
import "../common"

Item {
    id: root
    property int margins: 8

    // C++ model HomeFeaturedLiveModel.cpp
    HomeFeaturedLiveModel{
        id: homeFeaturedLiveModel
    }

    GlassPanel{
        anchors.fill: parent

        ListView{
            orientation: ListView.Horizontal
            model: homeFeaturedLiveModel

            anchors.fill: parent
            anchors.margins: root.margins
            spacing: root.margins
            clip: true
            interactive: false
            delegate: featuredItem
        }
    }

    Component{
        id: featuredItem

        HomeFeaturedButton{
            height: parent.height
            width: (ListView.view.width / homeFeaturedLiveModel.itemCount()) - 5

            img: model.image
            eventsText: homeFeaturedLiveModel.liveEventsText()
            sportText: homeFeaturedLiveModel.sportText()
            compText: model.name
            showIcon: false
            tagWidth: 130
            tagBackground: "yellow"
            sportTextSize: 14
            compTextSize: 16

            MouseArea{
                anchors.fill: parent
                onClicked: {
                    homeFeaturedLiveModel.selectedSport = model.sportid
                }
            }
        }
    }
}
import QtQuick 2.0

import midas.engine 1.0
import "../common"

Item {
    id: root
    property int margins: 8

    /*QtObject{
        id: kenoData
        property int maxItems: items.length
        property string iconpath: "image://svg/images/svg/offer/colour/"
        property string imgpath: "image://svg/images/svg/offer/flat/"
        // need to be able to pass in the width to c++ determine the number of items per page
        // each item would be a list, we are re-using the same list here
        property var items:
        [
            { img: imgpath + "keno",        icon: iconpath + "keno", name: "Keno" },
            { img: imgpath + "10e_lotto",   icon: iconpath + "10e_lotto", name: "Lotteries" },
        ]
    }*/

    // C++ model HomeKenoModel.cpp
    HomeKenoModel{
        id: homeKenoModel
    }

    GlassPanel{
        anchors.fill: parent

        ListView{
            anchors.fill: parent
            anchors.margins: root.margins
            model: homeKenoModel
            spacing: root.margins
            clip: true
            interactive: false

            delegate: featuredItem
        }
    }

    Component{
        id: featuredItem

        HomeCouponButton{
            width: parent ? parent.width : 0
            height: ( ListView.view.height / homeKenoModel.itemCount() ) - 5

            img: model.image
            icon: model.icon
            text: model.name
            iconAboveImg : true

            MouseArea{
                anchors.fill: parent
                onClicked: {
                    homeKenoModel.selectedOffer = model.ot
                }
            }
        }
    }
}
0import QtQuick 2.0

import midas.engine 1.0
import "../common"

Item {
    id: root
    property int margins: 8

    /*QtObject{
        id: liveData
        property int maxItems: items.length
        property string iconpath: "image://svg/images/svg/sports/"
        //property string imgpath: "file:///projects/qmltest/src/ui/images/sport/"
        property string imgpath: "file:///" + rootPath + "/images/sport/"
        // need to be able to pass in the width to c++ determine the number of items per page
        // each item would be a list, we are re-using the same list here
        property var items:
        [
            { img: imgpath + "football.png", icon: iconpath + "football", name: "Football", colour: "green"},
            { img: imgpath + "tabletennis.png", icon: iconpath + "table_tennis", name: "Table Tennis", colour: "orange" },
            { img: imgpath + "snooker.png", icon: iconpath + "snooker", name: "Snooker", colour: "blue" },
        ]
    }*/

    // C++ model HomeFeaturedLiveModel.cpp
    HomeFeaturedLiveModel{
        id: homeFeaturedLiveModel
        property int maxItems: 3  // this will need to be part of the model
    }

    GlassPanel{
        anchors.fill: parent

        ListView{
            anchors.fill: parent
            anchors.margins: root.margins
            model: homeFeaturedLiveModel
            spacing: root.margins
            clip: true
            interactive: false

            delegate: featuredItem
        }
    }

    Component{
        id: featuredItem

        HomeSportButton{
            width: parent.width            
            height: (( ListView.view.height - ListView.view.spacing * (homeFeaturedLiveModel.maxItems -1) ) / homeFeaturedLiveModel.maxItems)

            img:  model.image
            icon: model.icon
            text: model.name
            color: model.colour
            topHeight: height * 0.6
            bottomHeight: height - topHeight -2
            iconScale: 0.6
            fontSize: 16

            Rectangle{
                height: 20
                width: 40
                color: "yellow"
                radius: height/2
                anchors.top: parent.top
                anchors.right: parent.right
                anchors.margins: 8
                Text{
                    anchors.centerIn: parent
                    color: "black"
                    font.capitalization: Font.Capitalize
                    font.bold: true
                    font.pixelSize: 16
                    text: "LIVE"
                }


            }

            MouseArea{
                anchors.fill: parent
                onClicked: {
                    homeFeaturedLiveModel.selectedSport = model.sportid
                }
            }
        }
    }
}
xXMo0q+0'ibmPd@]["},d])H~(8e\tB+ebb:NtRhgLRRD&|]X\$z|M-|fQ'~z/C7FI"Fs||S/VQm%P xF:~@FukDTsU8SYIFh|U1
v+[{4RP3x3p!"w8;
F4	,fwfN"61h41MhE(N^+W9ar!F:2z	,YL-[Aa8['i\9Rc6YzM<q2Sa`eeH~zl5UTPl;lrL>L(FC",mFB,\3|6"SL.<jEUC@#%K$>:
S|?z.tequyS2[-<VS^g.dE^fW_d$Y;#*GNL>(}[Bm&3SSHjl9ejOWO/SrD_w!kVN+yJvFVu
_import QtQuick 2.0
import QtQuick.Controls 2.5

import midas.engine 1.0
import "../common"

Item {
    id: root
    property int margins: 8

    /*QtObject{
        id: compData
        property int maxItems: 7
        property int pages: items.length
        // need to be able to pass in the width to c++ determine the number of items per page
        // each item would be a list, we are re-using the same list here
        property string imgpath: "image://svg/images/svg/competition/"
        property var items:
        [
            [
                { img: imgpath + "68-Italy-SerieA", txt: "Seria A", colour: "red" },
                { img: imgpath + "68-Italy-SerieB", txt: "Seria B", colour: "blue" },
                { img: imgpath + "68-europe-ChampionsLeague", txt: "Champions League", colour: "orange" },
                { img: imgpath + "68-europe-EuropaLeague", txt: "Europa League", colour: "green" },
                { img: imgpath + "63-NBA", txt: "NBA", colour: "yellow" },
                { img: imgpath + "68-ATP", txt: "ATP", colour: "brown" },
                { img: imgpath + "71-usopen", txt: "US Open", colour: "purple" },
            ],
            [
                { img: imgpath + "81-Wimbledon", txt: "Wimbledon", colour: "purple" },
                { img: imgpath + "worldcup-worldcup", txt: "World Cup", colour: "brown" },
                { img: imgpath + "68-Belgium-CoupeDeBelgique", txt: "Belgian Cup", colour: "yellow" },
                { img: imgpath + "68-england-premierleague", txt: "England Premier League", colour: "green" },
                { img: imgpath + "68-Cyprus-Cup", txt: "Cyprus Cup", colour: "orange" },
                { img: imgpath + "81-WTA", txt: "WTA", colour: "blue" },
                { img: imgpath + "68-Spain-LaLiga", txt: "La Liga", colour: "red" },
            ]
        ]
    }*/

    // C++ model HomeCompetitionModel.cpp
    HomeCompetitionModel{
        id: homeCompetitionModel
    }

    Component{
        id: compDelegate

        ListView{
            id: compList

            orientation: ListView.Horizontal
            model: homeCompetitionModel.pageData
            spacing: root.margins
            clip: true
            interactive: false

        delegate: compDelegateItem

        }
    }

    Component{
        id: compDelegateItem

        HomeSportButton{
            height: parent.height            
            width: (( ListView.view.width - ListView.view.spacing * (homeCompetitionModel.pageSize() -1) ) / homeCompetitionModel.pageSize())

            topHeight: height * 0.6
            bottomHeight: height - topHeight -2

            icon: modelData.image
            text: modelData.competition
            color: modelData.colour
            regionicon: modelData.regionIcon
            showRegionIcon: modelData.showRegionIcon
			hasImage: false

            MouseArea{
                anchors.fill: parent
                onClicked: {
                    homeCompetitionModel.selectedCompetition = modelData.competitionid
                }
            }
        }
  }

    GlassSwipePanel{
        margins: root.margins
        swipeModel: homeCompetitionModel.pageCount
        swipeDelegate: compDelegate
        swipeSpacing: root.margins
    }
}
xV[o ~nmR}z0MTL{'Q$M/i99> yG"3Lr<"GeFbD$	h&q6j%g%r$i_`+fDHcvqbVDT$~(&2y)aLD;7mJLcTDi");"uCE1.PA8.dkhIV"v(YlGSTz~rvvV%+J&$z|Q#|Me)9)z]Whoaq],GiV*'{&|VD6OI^4k#TmRfmWpP9c)Bd?|PVJ&$Ol-,oU}z#8qhEsu-LY8u&*P7oj63Tn=OC{~#Ux~=Tm*]blbVlf=[*|h9eas{p}D-K:ZSah6A{mqto'_]5 $W5gdlXr9~Kcs:jTEso&>]v$/TuZnU0G82import QtQuick 2.0
import QtQuick.Layouts 1.3
import QtQuick.Controls 2.5

import midas.engine 1.0

import "../common"

Item {

    ViewManager{
        id: mVm
        className: "HomeNavBar"
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        Rectangle{

            Layout.fillWidth: true
            Layout.fillHeight: true
            color: mVm.background('#300000')
          /*  Text{
                anchors.centerIn: parent
                text: parent.height
            }*/

            HomeOfferSelect{
                anchors.fill: parent
            }
        }

        LangSelect{
            Layout.fillWidth: true
            Layout.maximumHeight: parent.height/2 - Layout.preferredHeight
            Layout.preferredHeight: 79
            maxHeight: Layout.maximumHeight//parent.height - width
        }

    }// columnLayout

}
import QtQuick 2.0

import "../common"
import midas.engine 1.0

Item {
    id: root
    // C++ model HomeVsportsModel.cpp
    HomeVsportsModel{
        id: homeVsportsModel        
    }
    property int margins: 8

    QtObject{
        id: vsportsData
        property int maxItems: homeVsportsModel.Items.length
        property int maxWidth: 155
    }

    GlassPanel
    {
        anchors.fill: parent
        ListView
        {
            orientation: ListView.Horizontal
            anchors.fill: parent
            anchors.margins: root.margins
            model: homeVsportsModel.Items
            spacing: root.margins
            clip: true
            interactive: false
            delegate: featuredItem
        }
    }

    Component
    {
        id: featuredItem
        HomeSportButton
        {
            height: parent.height
            width: (( ListView.view.width - ListView.view.spacing * (vsportsData.maxItems -1) ) / vsportsData.maxItems) > vsportsData.maxWidth ? vsportsData.maxWidth : (( ListView.view.width - ListView.view.spacing * (vsportsData.maxItems -1) ) / vsportsData.maxItems)
            topHeight: height * 0.7
            bottomHeight: height - topHeight -2
            img: "file:///" + rootPath + "/images/sport/" + modelData.img
            //icon: "image://svg/" + modelData.icon
			icon: modelData.icon
            text: modelData.name
            color: modelData.colour
            iconScale: 0.5
            fontSize: 12
			wrapMode: Text.Wrap
           
             MouseArea{
                anchors.fill: parent
                onClicked: 
		        {
			    	homeVsportsModel.sportClick( modelData.id, modelData.offerType )
			    }
            }
        }
    }
}
import QtQuick 2.0

import midas.engine 1.0
import "../common"

Item {
    id: root
    property int margins: 8

    // C++ model HomeCompBasicModel.cpp
    HomeSportBasicModel{
        id: homeSportBasicModel
    }

    GlassPanel{
        anchors.fill: parent

        ListView {
            anchors.fill: parent
            anchors.margins: root.margins
            model: homeSportBasicModel
            spacing: root.margins
            clip: true
            interactive: false

            delegate: featuredItem
        }
    }

    Component{
        id: featuredItem

        HomeCouponButton{
            width: parent ? parent.width : 0
            height: ( ListView.view.height / 4 ) - 6

            img: model.image
            icon: model.image
            text: model.sport

            MouseArea{
                anchors.fill: parent
                onClicked: {
                    homeSportBasicModel.selectedSport = model.sportid
                }
            }
        }
    }
}
bimport QtQuick 2.0

import midas.engine 1.0
import "../common"

Item {
    id: root
    property int margins: 8

    /*QtObject{
        id: couponData
        property int maxItems: items.length
        property string imgpath: "image://svg/images/svg/sports/"
        // need to be able to pass in the width to c++ determine the number of items per page
        // each item would be a list, we are re-using the same list here
        property var items:
        [
            { img: imgpath + "football", icon: imgpath + "othersports", name: "Top Leagues" },
            { img: imgpath + "football", icon: imgpath + "otherevents", name: "Midweek Coupon" },
        ]
    }*/

    // C++ model HomeCouponModel.cpp
    HomeCouponModel{
        id: homeCouponModel
    }

    GlassPanel{
        anchors.fill: parent

        ListView{
            anchors.fill: parent
            anchors.margins: root.margins
            model: homeCouponModel
            spacing: root.margins
            clip: true
            interactive: false

            delegate: featuredItem
        }
    }

    Component{
        id: featuredItem

        HomeCouponButton{
            width: parent ? parent.width : 0
            height: ( ListView.view.height / homeCouponModel.itemCount() ) - 5

            img: model.image
            icon: model.icon
            text: model.name

            MouseArea{
                anchors.fill: parent
                onClicked: {
                    homeCouponModel.selectedCoupon = model.coupon
                }
            }
        }
    }
}
xVKo8dd}"A"=,@KcIH;$E<H"g[<U-xxoy3i)E;r#<b!L%9&0"Gg/+{<JK(L$BBm-XxKQd~N~,Od<50z9~&!6=xuYq/[[(!}87,c1u9K1[cd`	P?/!Em:YL5@*h5f=A*ut
<ipu|I5G{n_