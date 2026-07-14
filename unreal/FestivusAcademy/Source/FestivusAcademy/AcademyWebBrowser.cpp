#include "AcademyWebBrowser.h"

#include "AcademyBrowserBridge.h"
#include "SWebBrowser.h"

namespace
{
const FString AcademyBridgeName = TEXT("academybridge");
}

void UAcademyWebBrowser::SetAcademyBridge(UAcademyBrowserBridge* InBridge)
{
    UnbindBridge();
    AcademyBridge = InBridge;
    BindBridge();
}

void UAcademyWebBrowser::ShutdownBrowser()
{
    SetAcademyBridge(nullptr);
    ReleaseSlateResources(true);
}

TSharedRef<SWidget> UAcademyWebBrowser::RebuildWidget()
{
    TSharedRef<SWidget> Widget = Super::RebuildWidget();
    BindBridge();
    return Widget;
}

void UAcademyWebBrowser::ReleaseSlateResources(bool bReleaseChildren)
{
    UnbindBridge();
    Super::ReleaseSlateResources(bReleaseChildren);
}

void UAcademyWebBrowser::BindBridge()
{
    if (WebBrowserWidget.IsValid() && AcademyBridge)
    {
        WebBrowserWidget->BindUObject(AcademyBridgeName, AcademyBridge, true);
    }
}

void UAcademyWebBrowser::UnbindBridge()
{
    if (WebBrowserWidget.IsValid() && AcademyBridge)
    {
        WebBrowserWidget->UnbindUObject(AcademyBridgeName, AcademyBridge, true);
    }
}
