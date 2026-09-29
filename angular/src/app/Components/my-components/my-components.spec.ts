import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyComponents } from './my-components';

describe('MyComponents', () => {
  let component: MyComponents;
  let fixture: ComponentFixture<MyComponents>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyComponents],
    }).compileComponents();

    fixture = TestBed.createComponent(MyComponents);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
