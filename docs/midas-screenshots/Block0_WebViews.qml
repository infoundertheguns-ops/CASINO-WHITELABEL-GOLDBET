mport QtQuick 2.0
import QtWebEngine 1.10
import QtWebChannel 1.0

import midas.engine 1.0

// for example see: https://retifrav.github.io/blog/2018/07/14/html-from-qml-over-webchannel-websockets/
Item {

    WebEngineView {       
        url: SecondScreenController.url
        //url: "https://www.stanleybet.info"
        anchors.fill: parent
        webChannel: myChan
        userScripts: webscript
    }

    WebEngineScript{
        id: webscript       
        sourceCode: SecondScreenController.script  //get from c++ class
        worldId: WebEngineScript.MainWorld
        runOnSubframes: true
    }

    WebChannel{
        id: myChan
        registeredObjects: [webviewObject]   // use a c++ class as the callback object
    }

    QtObject {
        id: webviewObject
        // ID, under which this object will be known at WebEngineView side
        WebChannel.id: "JSInterface"

        function bubble(operation, payload) {
            //console.log( "bubble called : " + operation + " " + payload )
            SecondScreenController.bubble(operation, payload)
        }

        function onClickHandler(){
            // do nothing here for the second screen
        }
    }

}
	import QtQuick 2.0
import QtQuick.Layouts 1.3
import QtWebView 1.1
import QtWebEngine 1.10

import midas.engine 1.0

Item {

    ColumnLayout{
        anchors.fill: parent
        spacing: 0

        Rectangle{  // close button and bar
            Layout.fillWidth: true
            Layout.minimumHeight: 60
            color: 'black'
            visible: WebViewController.showCloseButton

            Rectangle{
                height: parent.height -8
                width: height
                anchors.margins: 4
                anchors.verticalCenter: parent.verticalCenter
                anchors.right: parent.right
                color: 'black'
                border.color: 'white'

                Text{
                    text: 'X'
                    color: 'white'
                    font.bold: true
                    font.pixelSize: parent.height * 0.8
                    anchors.centerIn: parent
                }
            }
            MouseArea{
                anchors.fill: parent
                onClicked: {
                    console.log("SimpleWebView.qml : close button: close Web View")
                    WebViewController.closeWebView()
                }
            }
        }


        WebEngineView{
            Layout.fillWidth: true
            Layout.fillHeight: true

            //url: "https://www.stanleybet.info"
            url: WebViewController.url

            settings.pluginsEnabled: true
            settings.pdfViewerEnabled: true

            onLoadingChanged: {
                if (loadRequest.status === WebEngineLoadRequest.LoadSucceededStatus) {
                    //       runJavaScript("alert('hello');")
                }
            }
        }

        // WebView isn't working (missing plugin)  so using WebEngineView as a work around
        //    WebView{
        //        url: "https://www.stanleybet.info"
        //        //url: WebViewController.url
        //        anchors.fill: parent
        ////        Component.onCompleted: {
        ////            runJavaScript("alert('hello');")
        ////        }

        //    }

    }
    MouseArea{
        anchors.fill: parent
        enabled: WebViewController.closeOnClick
        onClicked: {
            console.log("SimpleWebView.qml : close Web View")
            WebViewController.closeWebView()
        }
    }

}
import QtQuick 2.0
import QtWebEngine 1.10
import QtWebChannel 1.0

import midas.engine 1.0

// for example see: https://retifrav.github.io/blog/2018/07/14/html-from-qml-over-webchannel-websockets/
Item {

    WebEngineView {       
        url: WebViewController.url
        anchors.fill: parent
        webChannel: myChan
        userScripts: webscript

        onLoadingChanged: {
            if (loadRequest.status === WebEngineLoadRequest.LoadSucceededStatus) {
                //       runJavaScript("alert('hello');")
                  //    runJavaScript( WebViewController.onPageLoaded() )
            }
        }
    }
    WebEngineScript{
        id: webscript       
        sourceCode: WebViewController.script  //get from c++ class
        worldId: WebEngineScript.MainWorld
        runOnSubframes: true
    }

    WebChannel{
        id: myChan
        registeredObjects: [webviewObject]   // use a c++ class as the callback object
    }

    QtObject {
        id: webviewObject
        // ID, under which this object will be known at WebEngineView side
        WebChannel.id: "JSInterface"

        function bubble(operation, payload) {
            //console.log( "bubble called : " + operation + " " + payload )
            WebViewController.bubble(operation, payload)
        }

        function onClickHandler(){
            //console.log("jsInterface.onClickHandler called")
            WebViewController.onClickHandler()
        }
    }
}
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="43px" height="25px" viewBox="0 0 43 25" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- Generator: Sketch 40.3 (33839) - http://www.bohemiancoding.com/sketch -->
    <title>TR</title>
    <desc>Created with Sketch.</desc>
    <defs></defs>
    <g id="Symbols" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="TR">
            <polygon id="Fill-9763" fill="#D00027" points="0 25 43 25 43 0 0 0"></polygon>
            <path d="M17.8042606,9.09190741 C16.6977263,7.34381944 14.7465075,6.18318442 12.5253033,6.18318442 C9.07986513,6.18318442 6.28757911,8.97708915 6.28757911,12.424146 C6.28757911,15.8703935 9.07986513,18.6642982 12.5253033,18.6642982 C14.7428459,18.6642982 16.6912924,17.5074867 17.7987814,15.7644313 C16.8854054,16.7805932 15.5609594,17.4195052 14.085746,17.4195052 C11.3290717,17.4195052 9.09281486,15.1832483 9.09281486,12.424146 C9.09281486,9.66989983 11.3290717,7.42878679 14.085746,7.42878679 C15.563912,7.42878679 16.8907064,8.07165182 17.8042606,9.09190741 Z" id="Combined-Shape" fill="#FFFFFF"></path>
            <path d="M21.2865182,13.5584232 L19.9544028,15.3969189 L19.9544028,13.1259671 L17.8007004,12.424146 L19.9544028,11.7252664 L19.9544028,9.45541988 L21.2872945,11.2914561 L23.4419275,10.5958057 L22.110485,12.4271272 L23.4419275,14.2613893 L21.2865182,13.5584232 Z" id="Combined-Shape" fill="#FFFFFF"></path>
        </g>
    </g>
</svg><?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="43px" height="25px" viewBox="0 0 43 25" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- Generator: Sketch 40.3 (33839) - http://www.bohemiancoding.com/sketch -->
    <title>FR</title>
    <desc>Created with Sketch.</desc>
    <defs></defs>
    <g id="Symbols" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="FR">
            <polygon id="Fill-8587" fill="#323E95" points="0 25.0583125 14.3594815 25.0583125 14.3594815 0 0 0"></polygon>
            <polygon id="Fill-8588" fill="#F4F4F4" points="14.3594815 25.0583125 28.7197778 25.0583125 28.7197778 0 14.3594815 0"></polygon>
            <polygon id="Fill-8589" fill="#D10000" points="28.7197778 25.0583125 43.0792593 25.0583125 43.0792593 0 28.7197778 0"></polygon>
        </g>
    </g>
</svg><?xml version="1.0" encoding="UTF-8"?>
<svg width="43px" height="25px" viewBox="0 0 43 25" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- Generator: Sketch 61 (89581) - https://sketch.com -->
    <title>spain (1)</title>
    <desc>Created with Sketch.</desc>
    <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="A4" transform="translate(-198.000000, -427.000000)" fill-rule="nonzero">
            <g id="spain-(1)" transform="translate(198.000000, 427.000000)">
                <rect id="Rectangle" fill="#FFDA44" x="0" y="0" width="43" height="25"></rect>
                <g id="Group" fill="#D80027">
                    <rect id="Rectangle" x="0" y="0.0241959064" width="43" height="8.31688596"></rect>
                    <rect id="Rectangle" x="0" y="16.6580409" width="43" height="8.31688596"></rect>
                </g>
            </g>
        </g>
    </g>
</svg>5<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="43px" height="25px" viewBox="0 0 43 25" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- Generator: Sketch 40.3 (33839) - http://www.bohemiancoding.com/sketch -->
    <title>NL</title>
    <desc>Created with Sketch.</desc>
    <defs></defs>
    <g id="Symbols" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="NL">
            <polygon id="Fill-7866" fill="#314588" points="0 25.059125 43 25.059125 43 0 0 0"></polygon>
            <polygon id="Fill-7867" fill="#FFFFFF" points="0 16.7058125 43 16.7058125 43 8 0 8"></polygon>
            <polygon id="Fill-7868" fill="#D0011B" points="0 8.354125 43 8.354125 43 0 0 0"></polygon>
        </g>
    </g>
</svg>}<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg
	width="900"
	height="600"
	xmlns="http://www.w3.org/2000/svg"
	id="Flag_of_Peru">
	<rect height="600" width="900" fill="#D91023" x="0" y="0" />
	<rect height="600" width="300" fill="white" x="300" y="0" />
</svg><?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="43px" height="25px" viewBox="0 0 43 25" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- Generator: Sketch 40.3 (33839) - http://www.bohemiancoding.com/sketch -->
    <title>RO</title>
    <desc>Created with Sketch.</desc>
    <defs></defs>
    <g id="Symbols" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="RO">
            <polygon id="Fill-14167" fill="#1C2A7D" points="0 25.059125 14.3594815 25.059125 14.3594815 0 0 0"></polygon>
            <polygon id="Fill-14168" fill="#F3D02F" points="14.3594815 25.059125 28.718963 25.059125 28.718963 0 14.3594815 0"></polygon>
            <polygon id="Fill-14169" fill="#D10000" points="28.718963 25.059125 43.0792593 25.059125 43.0792593 0 28.718963 0"></polygon>
        </g>
    </g>
</svg><?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="43px" height="25px" viewBox="0 0 43 25" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- Generator: Sketch 40.3 (33839) - http://www.bohemiancoding.com/sketch -->
    <title>DA</title>
    <desc>Created with Sketch.</desc>
    <defs></defs>
    <g id="Symbols" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="DA">
            <polygon id="Fill-8605" fill="#D10000" points="0 25.0583125 43.0792593 25.0583125 43.0792593 0 0 0"></polygon>
            <polygon id="Fill-8606" fill="#FFFFFF" points="13.9732593 25.0583125 18.6291111 25.0583125 18.6291111 0 13.9732593 0"></polygon>
            <polygon id="Fill-8607" fill="#FFFFFF" points="0 14.84925 43.0792593 14.84925 43.0792593 10.205 0 10.205"></polygon>
        </g>
    </g>
</svg>	0<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="43px" height="25px" viewBox="0 0 43 25" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- Generator: Sketch 40.3 (33839) - http://www.bohemiancoding.com/sketch -->
    <title>EN</title>
    <desc>Created with Sketch.</desc>
    <defs></defs>
    <g id="Symbols" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="EN">
            <polygon id="Fill-6201" fill="#FFFFFF" points="0 25.0566875 43.0800741 25.0566875 43.0800741 0 0 0"></polygon>
            <polyline id="Fill-6202" fill="#BD0034" points="28.9399706 9.059375 43 1.113125 43 0 42.030204 0 26 9.059375 28.9399706 9.059375"></polyline>
            <polygon id="Fill-6203" fill="#BD0034" points="43 24.162375 43 22.5 31.9781481 16 29 16"></polygon>
            <polyline id="Fill-6204" fill="#BD0034" points="0 1.664 12.7518519 8.8164375 15.7316296 8.8164375 0 0 0 1.664"></polyline>
            <polygon id="Fill-6205" fill="#BD0034" points="0 24.412625 0 25 2.5 25 18.0367407 16 15.0561481 16"></polygon>
            <polyline id="Fill-6206" fill="#1A237B" points="40.083037 0 25 0 25 8.422375 40.083037 0"></polyline>
            <polyline id="Fill-6207" fill="#1A237B" points="19.0227407 0 4 0 19.0227407 8.422375 19.0227407 0"></polyline>
            <polyline id="Fill-6208" fill="#1A237B" points="43 8.7484375 43 3 33 8.7484375 43 8.7484375"></polyline>
            <polyline id="Fill-6209" fill="#1A237B" points="43 21.6875 43 16 33 16 43 21.6875"></polyline>
            <polyline id="Fill-6210" fill="#1A237B" points="5 25 19.1704444 25 19.1704444 17 5 25"></polyline>
            <polyline id="Fill-6211" fill="#1A237B" points="25 25 39.2160741 25 25 17 25 25"></polyline>
            <polyline id="Fill-6212" fill="#1A237B" points="0 16 0 21.9434375 10.5885185 16 0 16"></polyline>
            <polyline id="Fill-6213" fill="#1A237B" points="0 8.952375 10.5885185 8.952375 0 3 0 8.952375"></polyline>
            <polyline id="Fill-6214" fill="#BD0034" points="19.6843071 0 19.6843071 10.5240118 0 10.5240118 0 14.9810305 19.6843071 14.9810305 19.6843071 25 23.6719184 25 23.6719184 14.9810305 43 14.9810305 43 10.5240118 23.6719184 10.5240118 23.6719184 0 19.6843071 0"></polyline>
        </g>
    </g>
</svg>"U]x\Ko]Gra63u!y`_7dla$wwsiLo,~<U]]/w_?~}yp}7//y._~_{77H7owpwH8^^?>~osX^w7?{o/?=;_[><;L+p+agtw_9K~k[9zsy'I3-wgk|Z_|{7wopVJc-@wG}<c(9hzpL5Bmm&P}@cnRSvL=W14|._~w`U!wyyZfX,?VHO>\& |8.e<j>c ;@|(dBzla^(fxp)fWc$B/15N0G1W!QhrG/HgRpl^rw;7$$zXKz*T;v*{{fe"7onT(fo"^F1{'j4taR6K(F#'"8`6#4XTXcescF}QQ,D\7Q!.yP"v:9}%%<g5tW<R@6M	R&v"
rZ3CD`^l
'u0@v0wUSX-bpX%j)Qq*	pDfh2fR=.&	Cut3?b6km"xkw9bl2oIEuc}`zP)jAPNG}$>](PoIX_+SF4BQ	l_]q*r,]
P3W~S'5@lETpfaB?!nr4LN8&3Ply@dgCFX@Po86G^@u'uJofC7B*p6'@SamV#y289\/LoNQJF2ZhAHXl@Ob
qAn5@tL:)3RvA	A{**Pl{tTS!r3<VYW" v|UN1qthB)!@raPmLTTH"3c$cZ+xqnZLF$#f%y$`24l791w`(L2EtVzVfr'~F:{Rtym?=W?{3x3SA Sr@l,j7X)$"u4E~*b2X8 @\jx=]-<Hz4s%t!+
d1f
Qe)@<?4-U3/W
?deA= N_#qy6bHQ7R&U1eZmHj@+9\Z=JLO>1]bgy*
W`Zk{J+kw!9q9sf0s@B%,eflE5c%Inc%I7J34(,)lAz^f'#up^++-T\cZZ4=cLE}~ea@<A>dK)$-TIcu&k?5aKHVZlk5$WR5ScRx\L0fq4^G05do?AQ",vB&'l59&Jq,-M/\]	GMr-tbK"}NBP3A|`LZ4W@1^~XE>@-!( j@$XJNOb?<-"P7&Fedn'qk[M6"l,:%xKNLj`[=:JGb" "O||,r16VfFwVD~WsV(V=I+Fb.C7*`+(x[jPlM2:@ZxlmRj(0@Xm
P=')T_4/mJ6`FyWe>kS-T2*lB.u`O#C&]qHM^:o:NW#}\+(bQG|Y(u5~LBI")gLx3j]m*Xc[HYXk:MX=^*ftr$;N q5= qBXZz4L8'C@-6vEF"6f`c]%\?{Qb2$84f({SlIfn[p:M9eTU$:yOC5lXOz6^60&"og~WSf=L8{^B|d7~r@0ji}6	-[ffNI:xv>G@R0Jbd&&n5
TRB5@9;3S@U~QJ`7Af'3sDo_f!4K=%MvkI7&]fD8
9L/1,fB([JklDn^mKWw[&&)G;X>NzNf5^xUmnh>;YB88J)$5tEFBI_+vw|4l_dZSa`@\j't
_	'} D^%j3x5E8kJy]N|R<kJC><q5s=LFl:"T/X)ZDXM2=8*3)PwVus42#e)SW4F]Lt2B<<Z`HS^>Tu$Ne\L(W;Hj3%bjk%QllS"j_bZ<pN)HjIe}-iSa%#<Rn\u==l4LiVeXUyI T7fAZlje
iEzx1ivin<"^jlq+Q:.&*;WDj)8ZES5^!
m[h#OS23"Y`BpNcs5sp)4iqjr Ac4&%aF&Wg0\jg%Zxlz|&=lyqIEh8Zxu+}<s'L=|F]dh$]r;}c#4'>Q9`m@"~wi pAmr8%)o61Ih2j/aQV5k$HJUr\2[yB 244:Xqq03T(uN% \\>(>n`#MeTBj[hPD55P%L]Kv_7SkpG^MQwNHM#DoQr*Fk[kJV]UHY/'$vtOTZi}SJ{ZRHu4jA3ag-i&"{}*JCOv4mh
EyOWb[hPMEyP2|q0q0qPXs`y4=aSlXdX$U'A
mw~F|&|bS`ndJs OLw$=Gh`$,2}H&i['v#X!3s:C*_[ (V&g1I]N*ukME=pS-s8>vW;lSSc$RDD!aV;V?9:xjl4mzu)J@t&_C`p_q7*'cH{1v\=e'pg;D~U8 w"I9mLm9+9W+OA*f=+dx#Y/ l%46~WA"ysVzd2Tg9q\1? %U'j]y1QpE#x."q&Z>:F7v:AT(9y;qO	i	WcbqB4V"_A _q0M`ksO;{DikD4x*Ol?"'R=}u
M'9t:
 >8TvH_O3	9<HX+
!7F6#S&2cElA>F2rb:rcU'n\X>IyKl$pm,dr	!N '#qzu~54o1'[Z40n*PacXm^9jz~G*P#z>5^dE\07*/EC1"y8M
"j^DnRecG9N"!Ms>)>-=`.Y:47E.-ifbxM}3H=]tHLg 4J@U^NFDMRzW)":k	UN_1LuPn+r
KK:?Ny+ Vh4O_MQPw
GoDIe{*D=-!D/fx Kg$v@jg y6U,leqw:6G@;@J3t"7f:>N+*"1/<'@R^ z{_?O8[c0h0]^b<F9Rk	&Xf%[/U%ycUw;S RZVYW6sNgD,~$P#7;G`u>sfJ~30%P>'$@sJE(B6_%DU3?E3]U}je93_s/9;Pq[c',4	f~4D#c)7uMslt]'B+ek(V1&$6{M&S[!636oRtM4Hb=<7_/~<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="43px" height="25px" viewBox="0 0 43 25" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- Generator: Sketch 40.3 (33839) - http://www.bohemiancoding.com/sketch -->
    <title>DE</title>
    <desc>Created with Sketch.</desc>
    <defs></defs>
    <g id="Symbols" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="DE">
            <polygon id="Fill-8577" fill="#000000" points="0 8.3500625 43.0808889 8.3500625 43.0808889 0 0 0"></polygon>
            <polygon id="Fill-8578" fill="#D10000" points="0 16.7041875 43.0808889 16.7041875 43.0808889 8.3500625 0 8.3500625"></polygon>
            <polygon id="Fill-8579" fill="#F7D928" points="0 25.0583125 43.0808889 25.0583125 43.0808889 16.7041875 0 16.7041875"></polygon>
        </g>
    </g>
</svg><?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="43px" height="25px" viewBox="0 0 43 25" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- Generator: Sketch 40.3 (33839) - http://www.bohemiancoding.com/sketch -->
    <title>IT</title>
    <desc>Created with Sketch.</desc>
    <defs></defs>
    <g id="Symbols" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="IT">
            <polygon id="Fill-8503" fill="#009246" points="0 25.0583125 14.3594815 25.0583125 14.3594815 0 0 0"></polygon>
            <polygon id="Fill-8504" fill="#F1F2F1" points="14.3594815 25.0583125 28.718963 25.0583125 28.718963 0 14.3594815 0"></polygon>
            <polygon id="Fill-8505" fill="#D10000" points="28.718963 25.0583125 43.0800741 25.0583125 43.0800741 0 28.718963 0"></pol