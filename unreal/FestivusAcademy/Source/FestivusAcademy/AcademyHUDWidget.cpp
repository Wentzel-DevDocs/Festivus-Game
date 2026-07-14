#include "AcademyHUDWidget.h"

#include "AcademyGameInstanceSubsystem.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/Button.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "WebBrowser.h"

namespace
{
void FillOverlay(UOverlaySlot* Slot)
{
    if (!Slot) return;
    Slot->SetHorizontalAlignment(HAlign_Fill);
    Slot->SetVerticalAlignment(VAlign_Fill);
}
}

void UAcademyHUDWidget::NativeConstruct()
{
    Super::NativeConstruct();

    UOverlay* Root = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("AcademyRoot"));
    WidgetTree->RootWidget = Root;

    UBorder* Dimmer = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("Dimmer"));
    Dimmer->SetBrushColor(FLinearColor(0.015f, 0.025f, 0.04f, 0.84f));
    FillOverlay(Root->AddChildToOverlay(Dimmer));

    USizeBox* MenuWidth = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass(), TEXT("MenuWidth"));
    MenuWidth->SetWidthOverride(760.0f);
    UOverlaySlot* MenuWidthSlot = Root->AddChildToOverlay(MenuWidth);
    MenuWidthSlot->SetHorizontalAlignment(HAlign_Center);
    MenuWidthSlot->SetVerticalAlignment(VAlign_Center);
    MenuWidthSlot->SetPadding(FMargin(32.0f));

    UBorder* MenuBorder = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("MenuBorder"));
    MenuBorder->SetBrushColor(FLinearColor(0.025f, 0.045f, 0.065f, 0.94f));
    MenuBorder->SetPadding(FMargin(34.0f));
    MenuWidth->SetContent(MenuBorder);

    UVerticalBox* Menu = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("AcademyMenu"));
    MenuBorder->SetContent(Menu);

    UTextBlock* Eyebrow = CreateText(TEXT("THE FEATS WERE ONLY THE ENTRANCE EXAM"), 16, FLinearColor(0.91f, 0.66f, 0.25f));
    Menu->AddChildToVerticalBox(Eyebrow)->SetPadding(FMargin(0, 0, 0, 10));

    UTextBlock* Title = CreateText(TEXT("JUSTIN'S DEVELOPER ACADEMY"), 43, FLinearColor(0.94f, 0.97f, 0.95f));
    Menu->AddChildToVerticalBox(Title)->SetPadding(FMargin(0, 0, 0, 12));

    UTextBlock* Description = CreateText(
        TEXT("Enter a technology room, repair a production system, and learn the decisions behind a multiplayer SaaS game."),
        20,
        FLinearColor(0.68f, 0.74f, 0.78f));
    Menu->AddChildToVerticalBox(Description)->SetPadding(FMargin(0, 0, 0, 24));

    UButton* TeaserButton = CreateMenuButton(TEXT("PLAY THE CINEMATIC TEASER"), FLinearColor(0.91f, 0.66f, 0.25f));
    TeaserButton->OnClicked.AddDynamic(this, &UAcademyHUDWidget::OpenTeaser);
    Menu->AddChildToVerticalBox(TeaserButton)->SetPadding(FMargin(0, 0, 0, 10));

    UButton* NextButton = CreateMenuButton(TEXT("ROOM 01  ·  NEXT.JS + REACT + NODE  ·  OPEN"), FLinearColor(0.26f, 0.78f, 0.48f));
    NextButton->OnClicked.AddDynamic(this, &UAcademyHUDWidget::OpenNextRoom);
    Menu->AddChildToVerticalBox(NextButton)->SetPadding(FMargin(0, 0, 0, 8));

    UButton* SwiftButton = CreateMenuButton(TEXT("ROOM 02  ·  SWIFTUI  ·  SEQUENCED"), FLinearColor(0.43f, 0.72f, 1.0f));
    SwiftButton->OnClicked.AddDynamic(this, &UAcademyHUDWidget::OpenSwiftUIRoom);
    Menu->AddChildToVerticalBox(SwiftButton)->SetPadding(FMargin(0, 0, 0, 8));

    UButton* AndroidButton = CreateMenuButton(TEXT("ROOM 03  ·  ANDROID + KOTLIN  ·  SEQUENCED"), FLinearColor(0.64f, 0.84f, 0.37f));
    AndroidButton->OnClicked.AddDynamic(this, &UAcademyHUDWidget::OpenAndroidRoom);
    Menu->AddChildToVerticalBox(AndroidButton)->SetPadding(FMargin(0, 0, 0, 8));

    UButton* ExpoButton = CreateMenuButton(TEXT("ROOM 04  ·  EXPO  ·  SEQUENCED"), FLinearColor(0.78f, 0.71f, 1.0f));
    ExpoButton->OnClicked.AddDynamic(this, &UAcademyHUDWidget::OpenExpoRoom);
    Menu->AddChildToVerticalBox(ExpoButton)->SetPadding(FMargin(0, 0, 0, 18));

    StatusText = CreateText(TEXT("CONNECTING TO CURRICULUM SERVICE…"), 14, FLinearColor(0.52f, 0.58f, 0.62f));
    Menu->AddChildToVerticalBox(StatusText);

    ExperienceLayer = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("ExperienceLayer"));
    ExperienceLayer->SetVisibility(ESlateVisibility::Collapsed);
    FillOverlay(Root->AddChildToOverlay(ExperienceLayer));

    Browser = WidgetTree->ConstructWidget<UWebBrowser>(UWebBrowser::StaticClass(), TEXT("AcademyBrowser"));
    FillOverlay(ExperienceLayer->AddChildToOverlay(Browser));

    UButton* CloseButton = CreateMenuButton(TEXT("← RETURN TO ACADEMY HUB"), FLinearColor(0.91f, 0.66f, 0.25f));
    CloseButton->OnClicked.AddDynamic(this, &UAcademyHUDWidget::CloseExperience);
    UOverlaySlot* CloseSlot = ExperienceLayer->AddChildToOverlay(CloseButton);
    CloseSlot->SetHorizontalAlignment(HAlign_Left);
    CloseSlot->SetVerticalAlignment(VAlign_Top);
    CloseSlot->SetPadding(FMargin(18.0f));

    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
    {
        Academy->OnCatalogLoaded.AddDynamic(this, &UAcademyHUDWidget::HandleCatalogLoaded);
        if (Academy->GetRooms().Num() > 0)
        {
            HandleCatalogLoaded(true);
        }
    }
}

void UAcademyHUDWidget::NativeDestruct()
{
    if (GetGameInstance())
    {
        if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        {
            Academy->OnCatalogLoaded.RemoveDynamic(this, &UAcademyHUDWidget::HandleCatalogLoaded);
        }
    }
    Super::NativeDestruct();
}

UTextBlock* UAcademyHUDWidget::CreateText(const FString& Value, int32 Size, const FLinearColor& Color)
{
    UTextBlock* Text = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass());
    Text->SetText(FText::FromString(Value));
    Text->SetColorAndOpacity(FSlateColor(Color));
    Text->SetAutoWrapText(true);
    FSlateFontInfo Font = Text->GetFont();
    Font.Size = Size;
    Text->SetFont(Font);
    return Text;
}

UButton* UAcademyHUDWidget::CreateMenuButton(const FString& Label, const FLinearColor& Accent)
{
    UButton* Button = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass());
    Button->SetBackgroundColor(FLinearColor(Accent.R * 0.18f, Accent.G * 0.18f, Accent.B * 0.18f, 0.98f));
    Button->SetToolTipText(FText::FromString(Label));
    UTextBlock* Text = CreateText(Label, 16, Accent);
    Text->SetJustification(ETextJustify::Center);
    Button->SetContent(Text);
    return Button;
}

void UAcademyHUDWidget::OpenExperience(const FString& Url)
{
    if (!Browser || !ExperienceLayer) return;
    Browser->LoadURL(Url);
    ExperienceLayer->SetVisibility(ESlateVisibility::Visible);
}

void UAcademyHUDWidget::OpenTeaser()
{
    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        OpenExperience(Academy->GetTeaserUrl());
}

void UAcademyHUDWidget::OpenNextRoom()
{
    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        OpenExperience(Academy->GetRoomUrl(TEXT("nextjs-react-node")));
}

void UAcademyHUDWidget::OpenSwiftUIRoom()
{
    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        OpenExperience(Academy->GetRoomUrl(TEXT("swiftui")));
}

void UAcademyHUDWidget::OpenAndroidRoom()
{
    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        OpenExperience(Academy->GetRoomUrl(TEXT("android-kotlin")));
}

void UAcademyHUDWidget::OpenExpoRoom()
{
    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        OpenExperience(Academy->GetRoomUrl(TEXT("expo")));
}

void UAcademyHUDWidget::CloseExperience()
{
    if (ExperienceLayer) ExperienceLayer->SetVisibility(ESlateVisibility::Collapsed);
}

void UAcademyHUDWidget::HandleCatalogLoaded(bool bSucceeded)
{
    if (!StatusText) return;
    if (bSucceeded)
    {
        const UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>();
        const int32 RoomCount = Academy ? Academy->GetRooms().Num() : 0;
        StatusText->SetText(FText::FromString(FString::Printf(TEXT("CURRICULUM ONLINE  ·  %d ROOMS  ·  WEB-DELIVERED"), RoomCount)));
        StatusText->SetColorAndOpacity(FSlateColor(FLinearColor(0.26f, 0.78f, 0.48f)));
    }
    else
    {
        StatusText->SetText(FText::FromString(TEXT("CURRICULUM SERVICE OFFLINE  ·  START PNPM DEV  ·  ROOM LINKS STILL AVAILABLE")));
        StatusText->SetColorAndOpacity(FSlateColor(FLinearColor(0.91f, 0.66f, 0.25f)));
    }
}
