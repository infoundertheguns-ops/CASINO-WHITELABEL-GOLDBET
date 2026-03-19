import QtQuick 2.0
import QtQuick.Controls 2.5

import midas.engine 1.0
import "../common"

Item {
    id: root
    property int margins: 8


    /*QtObject{
        id: promoData
        property int pages: items.length
        property int maxItems: 3
        property string iconpath: "image://svg/images/svg/sports/"
        //property string imgpath: "file:///projects/qmltest/src/ui/images/sport/"
        property string imgpath: "file:///" + rootPath + "/images/sport/"

        // need to be able to pass in the width to c++ determine the number of items per page
        // each item would be a list, we are re-using the same list here
        property var items:
        [
            [
                { img: imgpath + "football.png", icon: iconpath + "football", sportName: "Football", compName: "Champions League", numEvents: "30 Events" },
                { img: imgpath + "tennis.png", icon: iconpath + "tennis", sportName: "Tennis", compName: "ATP Mens", numEvents: "8 Events" },
                { img: imgpath + "basket.png", icon: iconpath + "basketball", sportName: "Basketball", compName: "NBA", numEvents: "11 Events" },
            ],
            [
                { img: imgpath + "golf.png", icon: iconpath + "golf", sportName: "Golf", compName: "PGA", numEvents: "4 Events" },
                { img: imgpath + "icehockey.png", icon: iconpath + "hockey", sportName: "Hockey", compName: "NHL", numEvents: "9 Events" },
                { img: imgpath + "formula1.png", icon: iconpath + "formula1", sportName: "Formula 1", compName: "Grand Prix", numEvents: "7 Events" },
            ]
        ]
    }*/

    // C++ model HomeFeaturedModel.cpp
    HomeFeaturedModel{
       id: homeFeaturedModel
    }

    Component{
        id: promoDelegate
        ListView{

            orientation: ListView.Horizontal
            model: homeFeaturedModel.pageData
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
            width: (ListView.view.width / homeFeaturedModel.pageSize()) - 5

            img: modelData.img
            icon: modelData.icon
            eventsText: modelData.numEvents
            sportText: modelData.sportName
            compText: modelData.compName

            MouseArea{
                anchors.fill: parent
                onClicked: {
                    homeFeaturedModel.selectedItem = modelData.index
                }
            }
        }
    }

    GlassSwipePanel{
        margins: root.margins
        swipeModel: homeFeaturedModel.pageCount
        swipeDelegate: promoDelegate
    }

}
