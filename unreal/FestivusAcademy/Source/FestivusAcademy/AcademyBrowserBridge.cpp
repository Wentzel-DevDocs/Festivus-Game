#include "AcademyBrowserBridge.h"

#include "AcademyHUDWidget.h"

void UAcademyBrowserBridge::Initialize(UAcademyHUDWidget* InOwner)
{
    Owner = InOwner;
}

void UAcademyBrowserBridge::Ready(const FString& EntryToken)
{
    if (UAcademyHUDWidget* HUD = Owner.Get())
    {
        HUD->HandleBrowserBridgeReady(EntryToken);
    }
}
